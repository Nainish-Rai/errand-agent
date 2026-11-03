import type { OperatorRead, OperatorReadKind, OperatorReadLog, OperatorReadSummary } from "../../core/ports/operator-read-log";
import { migrate, type Database, type Migration } from "./database";

// The operator read audit in the shared SQLite database (ticket 19): one row per read, never
// updated or deleted, so the console's counts are the rows themselves.

export const OPERATOR_READ_MIGRATIONS: readonly Migration[] = [
  {
    id: "1901_operator_reads",
    sql: `CREATE TABLE operator_reads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operator_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('trace', 'context', 'transcript')),
      read_at_ms INTEGER NOT NULL
    );
    CREATE INDEX operator_reads_by_session ON operator_reads (session_id, read_at_ms);`,
  },
];

interface SummaryRow {
  operator_id: string;
  kind: string;
  reads: number;
  first_at_ms: number;
  last_at_ms: number;
}

export class SqliteOperatorReadLog implements OperatorReadLog {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
    migrate(db, OPERATOR_READ_MIGRATIONS);
  }

  async record(read: OperatorRead): Promise<void> {
    this.#db
      .prepare("INSERT INTO operator_reads (operator_id, session_id, kind, read_at_ms) VALUES (?, ?, ?, ?)")
      .run(read.operatorId, read.sessionId, read.kind, read.atMs);
  }

  async summarize(sessionId: string): Promise<readonly OperatorReadSummary[]> {
    const rows = this.#db
      .prepare(
        `SELECT operator_id, kind, COUNT(*) AS reads, MIN(read_at_ms) AS first_at_ms, MAX(read_at_ms) AS last_at_ms
         FROM operator_reads WHERE session_id = ? GROUP BY operator_id, kind ORDER BY last_at_ms DESC, operator_id, kind`,
      )
      .all(sessionId) as unknown as SummaryRow[];
    return rows.map((row) => ({
      operatorId: row.operator_id,
      kind: row.kind as OperatorReadKind,
      reads: Number(row.reads),
      firstAtMs: Number(row.first_at_ms),
      lastAtMs: Number(row.last_at_ms),
    }));
  }
}
