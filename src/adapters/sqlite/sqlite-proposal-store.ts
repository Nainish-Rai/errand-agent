import type { Grant } from "../../core/approval/grant";
import type { ProposalInvalidation } from "../../core/approval/invalidation";
import type { BookingTerms, Proposal, ProposalStatus } from "../../core/approval/proposal";
import type { ProposalQuery, ProposalStore } from "../../core/ports/proposal-store";
import { migrate, type Database, type Migration } from "./database";

// Proposals and grants in the shared SQLite database. The schema itself enforces the two rules
// that must hold under races: one grant per proposal (UNIQUE proposal_id) and a grant used once
// (consume is a conditional UPDATE that only one caller can win). node:sqlite is synchronous, so
// each method's statements run without interleaving.

export const PROPOSAL_MIGRATIONS: readonly Migration[] = [
  {
    id: "0500_proposals",
    sql: `CREATE TABLE proposals (
      proposal_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      terms_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      booking_id TEXT,
      seq INTEGER NOT NULL
    );
    CREATE INDEX proposals_by_session ON proposals (session_id, seq);
    CREATE INDEX proposals_by_user ON proposals (user_id, seq);
    CREATE UNIQUE INDEX proposals_by_booking ON proposals (booking_id) WHERE booking_id IS NOT NULL;`,
  },
  {
    id: "0501_grants",
    sql: `CREATE TABLE grants (
      grant_id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL UNIQUE REFERENCES proposals (proposal_id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL,
      user_id TEXT NOT NULL,
      issued_at_ms INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      consumed_at_ms INTEGER
    );`,
  },
  // Ticket 06: a grant whose terms changed before it was used is voided, never consumed, and the
  // proposal it was for keeps what changed and which proposal replaced it.
  {
    id: "0600_grant_voids",
    sql: "ALTER TABLE grants ADD COLUMN voided_at_ms INTEGER;",
  },
  {
    id: "0601_proposal_invalidations",
    sql: "ALTER TABLE proposals ADD COLUMN invalidation_json TEXT;",
  },
];

interface ProposalRow {
  proposal_id: string;
  session_id: string;
  user_id: string;
  fingerprint: string;
  terms_json: string;
  status: string;
  created_at_ms: number;
  booking_id: string | null;
  invalidation_json: string | null;
}

interface GrantRow {
  grant_id: string;
  proposal_id: string;
  fingerprint: string;
  user_id: string;
  issued_at_ms: number;
  expires_at_ms: number;
  consumed_at_ms: number | null;
  voided_at_ms: number | null;
}

function proposalFrom(row: ProposalRow): Proposal {
  return {
    proposalId: row.proposal_id,
    sessionId: row.session_id,
    userId: row.user_id,
    terms: JSON.parse(row.terms_json) as BookingTerms,
    fingerprint: row.fingerprint,
    status: row.status as ProposalStatus,
    createdAtMs: row.created_at_ms,
    ...(row.booking_id === null ? {} : { bookingId: row.booking_id }),
    ...(row.invalidation_json === null ? {} : { invalidation: JSON.parse(row.invalidation_json) as ProposalInvalidation }),
  };
}

function grantFrom(row: GrantRow): Grant {
  return {
    grantId: row.grant_id,
    proposalId: row.proposal_id,
    fingerprint: row.fingerprint,
    userId: row.user_id,
    issuedAtMs: row.issued_at_ms,
    expiresAtMs: row.expires_at_ms,
    ...(row.consumed_at_ms === null ? {} : { consumedAtMs: row.consumed_at_ms }),
    ...(row.voided_at_ms === null ? {} : { voidedAtMs: row.voided_at_ms }),
  };
}

export class SqliteProposalStore implements ProposalStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
    migrate(db, PROPOSAL_MIGRATIONS);
  }

  async saveProposal(proposal: Proposal): Promise<void> {
    // `seq` orders proposals by when they were first saved; an update keeps it.
    this.#db
      .prepare(
        `INSERT INTO proposals (proposal_id, session_id, user_id, action, fingerprint, terms_json, status, created_at_ms, booking_id, invalidation_json, seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM proposals))
         ON CONFLICT (proposal_id) DO UPDATE SET status = excluded.status, booking_id = excluded.booking_id, invalidation_json = excluded.invalidation_json`,
      )
      .run(
        proposal.proposalId,
        proposal.sessionId,
        proposal.userId,
        proposal.terms.action,
        proposal.fingerprint,
        JSON.stringify(proposal.terms),
        proposal.status,
        proposal.createdAtMs,
        proposal.bookingId ?? null,
        proposal.invalidation === undefined ? null : JSON.stringify(proposal.invalidation),
      );
  }

  async findProposal(proposalId: string): Promise<Proposal | undefined> {
    const row = this.#db.prepare("SELECT * FROM proposals WHERE proposal_id = ?").get(proposalId) as ProposalRow | undefined;
    return row === undefined ? undefined : proposalFrom(row);
  }

  async latestProposalOf(sessionId: string): Promise<Proposal | undefined> {
    const row = this.#db
      .prepare("SELECT * FROM proposals WHERE session_id = ? ORDER BY seq DESC LIMIT 1")
      .get(sessionId) as ProposalRow | undefined;
    return row === undefined ? undefined : proposalFrom(row);
  }

  async findProposalByBooking(bookingId: string): Promise<Proposal | undefined> {
    const row = this.#db.prepare("SELECT * FROM proposals WHERE booking_id = ?").get(bookingId) as ProposalRow | undefined;
    return row === undefined ? undefined : proposalFrom(row);
  }

  async listProposals(query: ProposalQuery): Promise<readonly Proposal[]> {
    const rows = this.#db
      .prepare(
        `SELECT * FROM proposals
         WHERE user_id = ? AND (? IS NULL OR status = ?) AND (? IS NULL OR session_id = ?)
         ORDER BY seq DESC`,
      )
      .all(query.userId, query.status ?? null, query.status ?? null, query.sessionId ?? null, query.sessionId ?? null) as unknown as ProposalRow[];
    return rows.map(proposalFrom);
  }

  async issueGrant(grant: Grant): Promise<Grant> {
    this.#db
      .prepare(
        `INSERT INTO grants (grant_id, proposal_id, fingerprint, user_id, issued_at_ms, expires_at_ms, consumed_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT (proposal_id) DO NOTHING`,
      )
      .run(grant.grantId, grant.proposalId, grant.fingerprint, grant.userId, grant.issuedAtMs, grant.expiresAtMs);
    const stored = await this.grantOf(grant.proposalId);
    if (stored === undefined) throw new Error(`The grant for ${grant.proposalId} was neither stored nor found.`);
    return stored;
  }

  async grantOf(proposalId: string): Promise<Grant | undefined> {
    const row = this.#db.prepare("SELECT * FROM grants WHERE proposal_id = ?").get(proposalId) as GrantRow | undefined;
    return row === undefined ? undefined : grantFrom(row);
  }

  async consumeGrant(grantId: string, atMs: number): Promise<boolean> {
    const result = this.#db
      .prepare("UPDATE grants SET consumed_at_ms = ? WHERE grant_id = ? AND consumed_at_ms IS NULL AND voided_at_ms IS NULL")
      .run(atMs, grantId);
    return Number(result.changes) === 1;
  }

  async voidGrant(grantId: string, atMs: number): Promise<boolean> {
    const result = this.#db
      .prepare("UPDATE grants SET voided_at_ms = ? WHERE grant_id = ? AND consumed_at_ms IS NULL AND voided_at_ms IS NULL")
      .run(atMs, grantId);
    return Number(result.changes) === 1;
  }

  async discardAll(): Promise<void> {
    this.#db.exec("DELETE FROM grants; DELETE FROM proposals;");
  }
}
