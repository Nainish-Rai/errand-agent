import type { ActionIntent, ActionIntentState, ResolvedBy } from "../../core/booking/action-intent";
import type { ActionIntentQuery, ActionLedger } from "../../core/ports/action-ledger";
import { migrate, type Database, type Migration } from "./database";

// The action ledger in the shared SQLite database. The idempotency key is the primary key, so an
// intent is recorded once however many executions race to write it, and every change is a
// conditional UPDATE on the version it was made from, so two writers (an execution and the
// reconciler) can't overwrite each other. node:sqlite is synchronous: a recorded intent is on disk
// before `book` is sent, which is what lets the reconciler find it after a crash.

export const ACTION_LEDGER_MIGRATIONS: readonly Migration[] = [
  {
    id: "0700_action_ledger",
    sql: `CREATE TABLE action_intents (
      idempotency_key TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      proposal_id TEXT NOT NULL,
      grant_id TEXT NOT NULL UNIQUE,
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      hold_id TEXT NOT NULL,
      hold_expires_at TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending', 'confirmed', 'failed', 'unknown')),
      attempts INTEGER NOT NULL,
      version INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      last_attempt_at_ms INTEGER,
      booking_id TEXT,
      failure_reason TEXT,
      resolved_at_ms INTEGER,
      resolved_by TEXT,
      notice_delivered_at_ms INTEGER,
      seq INTEGER NOT NULL
    );
    CREATE INDEX action_intents_by_session ON action_intents (session_id, seq);
    CREATE INDEX action_intents_unresolved ON action_intents (state) WHERE state IN ('pending', 'unknown');
    CREATE UNIQUE INDEX action_intents_by_booking ON action_intents (booking_id) WHERE booking_id IS NOT NULL;`,
  },
];

interface IntentRow {
  idempotency_key: string;
  proposal_id: string;
  grant_id: string;
  session_id: string;
  user_id: string;
  hold_id: string;
  hold_expires_at: string;
  state: string;
  attempts: number;
  version: number;
  created_at_ms: number;
  updated_at_ms: number;
  last_attempt_at_ms: number | null;
  booking_id: string | null;
  failure_reason: string | null;
  resolved_at_ms: number | null;
  resolved_by: string | null;
  notice_delivered_at_ms: number | null;
}

function optional<K extends string, V>(key: K, value: V | null): { [P in K]?: V } {
  return (value === null ? {} : { [key]: value }) as { [P in K]?: V };
}

function intentFrom(row: IntentRow): ActionIntent {
  return {
    idempotencyKey: row.idempotency_key,
    action: "book",
    proposalId: row.proposal_id,
    grantId: row.grant_id,
    sessionId: row.session_id,
    userId: row.user_id,
    holdId: row.hold_id,
    holdExpiresAt: row.hold_expires_at,
    state: row.state as ActionIntentState,
    attempts: row.attempts,
    version: row.version,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    ...optional("lastAttemptAtMs", row.last_attempt_at_ms),
    ...optional("bookingId", row.booking_id),
    ...optional("failureReason", row.failure_reason),
    ...optional("resolvedAtMs", row.resolved_at_ms),
    ...optional("resolvedBy", row.resolved_by as ResolvedBy | null),
    ...optional("noticeDeliveredAtMs", row.notice_delivered_at_ms),
  };
}

const FILTER = `(? IS NULL OR session_id = ?) AND (? IS NULL OR user_id = ?) AND (? IS NULL OR grant_id = ?)`;

function filterValues(query: ActionIntentQuery): (string | null)[] {
  const values = [query.sessionId, query.userId, query.grantId].map((value) => value ?? null);
  return values.flatMap((value) => [value, value]);
}

export class SqliteActionLedger implements ActionLedger {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
    migrate(db, ACTION_LEDGER_MIGRATIONS);
  }

  async record(intent: ActionIntent): Promise<ActionIntent> {
    this.#db
      .prepare(
        `INSERT INTO action_intents (idempotency_key, action, proposal_id, grant_id, session_id, user_id, hold_id, hold_expires_at,
           state, attempts, version, created_at_ms, updated_at_ms, seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM action_intents))
         ON CONFLICT (idempotency_key) DO NOTHING`,
      )
      .run(
        intent.idempotencyKey,
        intent.action,
        intent.proposalId,
        intent.grantId,
        intent.sessionId,
        intent.userId,
        intent.holdId,
        intent.holdExpiresAt,
        intent.state,
        intent.attempts,
        intent.version,
        intent.createdAtMs,
        intent.updatedAtMs,
      );
    const stored = await this.find(intent.idempotencyKey);
    if (stored === undefined) throw new Error(`Intent ${intent.idempotencyKey} was neither stored nor found.`);
    return stored;
  }

  async find(idempotencyKey: string): Promise<ActionIntent | undefined> {
    const row = this.#db.prepare("SELECT * FROM action_intents WHERE idempotency_key = ?").get(idempotencyKey) as IntentRow | undefined;
    return row === undefined ? undefined : intentFrom(row);
  }

  async advance(next: ActionIntent): Promise<boolean> {
    const result = this.#db
      .prepare(
        `UPDATE action_intents SET state = ?, attempts = ?, version = ?, updated_at_ms = ?, last_attempt_at_ms = ?, booking_id = ?,
           failure_reason = ?, resolved_at_ms = ?, resolved_by = ?, notice_delivered_at_ms = ?
         WHERE idempotency_key = ? AND version = ?`,
      )
      .run(
        next.state,
        next.attempts,
        next.version,
        next.updatedAtMs,
        next.lastAttemptAtMs ?? null,
        next.bookingId ?? null,
        next.failureReason ?? null,
        next.resolvedAtMs ?? null,
        next.resolvedBy ?? null,
        next.noticeDeliveredAtMs ?? null,
        next.idempotencyKey,
        next.version - 1,
      );
    return Number(result.changes) === 1;
  }

  async unresolved(query: ActionIntentQuery = {}): Promise<readonly ActionIntent[]> {
    const rows = this.#db
      .prepare(`SELECT * FROM action_intents WHERE state IN ('pending', 'unknown') AND ${FILTER} ORDER BY seq`)
      .all(...filterValues(query)) as unknown as IntentRow[];
    return rows.map(intentFrom);
  }

  async list(query: ActionIntentQuery): Promise<readonly ActionIntent[]> {
    const rows = this.#db
      .prepare(`SELECT * FROM action_intents WHERE ${FILTER} ORDER BY seq`)
      .all(...filterValues(query)) as unknown as IntentRow[];
    return rows.map(intentFrom);
  }

  async discardAll(): Promise<void> {
    this.#db.exec("DELETE FROM action_intents;");
  }
}
