import type { SessionOwnerStore, SessionOwnership } from "../../core/ports/session-owner-store";
import { migrate, type Database, type Migration } from "./database";

// Session owners in the shared SQLite database (ticket 19). The session id is the primary key and a
// claim never overwrites, so the first caller to reach a session stays its owner across restarts.

export const SESSION_OWNER_MIGRATIONS: readonly Migration[] = [
  {
    id: "1900_session_owners",
    sql: `CREATE TABLE session_owners (
      session_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      claimed_at_ms INTEGER NOT NULL
    );
    CREATE INDEX session_owners_by_time ON session_owners (claimed_at_ms);`,
  },
];

interface OwnerRow {
  session_id: string;
  owner_id: string;
  claimed_at_ms: number;
}

function ownershipOf(row: OwnerRow): SessionOwnership {
  return { sessionId: row.session_id, ownerId: row.owner_id, claimedAtMs: row.claimed_at_ms };
}

export class SqliteSessionOwnerStore implements SessionOwnerStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
    migrate(db, SESSION_OWNER_MIGRATIONS);
  }

  async claim(claim: SessionOwnership): Promise<string> {
    this.#db
      .prepare("INSERT INTO session_owners (session_id, owner_id, claimed_at_ms) VALUES (?, ?, ?) ON CONFLICT (session_id) DO NOTHING")
      .run(claim.sessionId, claim.ownerId, claim.claimedAtMs);
    const owner = await this.ownerOf(claim.sessionId);
    if (owner === undefined) throw new Error(`Session ${claim.sessionId} was neither claimed nor found.`);
    return owner;
  }

  async ownerOf(sessionId: string): Promise<string | undefined> {
    const row = this.#db.prepare("SELECT owner_id FROM session_owners WHERE session_id = ?").get(sessionId) as { owner_id: string } | undefined;
    return row?.owner_id;
  }

  async list(): Promise<readonly SessionOwnership[]> {
    const rows = this.#db.prepare("SELECT * FROM session_owners ORDER BY claimed_at_ms DESC, session_id").all() as unknown as OwnerRow[];
    return rows.map(ownershipOf);
  }
}
