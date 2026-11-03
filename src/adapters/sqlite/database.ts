import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * One SQLite file per backend process, shared by every store that must survive a restart
 * (proposals and grants, the action ledger, run budgets, memory facts, errands).
 *
 * Each store owns its tables and declares them as migrations. A migration runs once, in id order,
 * inside a transaction, and is recorded in `schema_migrations`, so adding a store never edits
 * another store's schema.
 */
export interface Migration {
  /** Unique and sortable, prefixed by the owning store: "0001_proposals", "0002_action_ledger". */
  readonly id: string;
  readonly sql: string;
}

export type Database = DatabaseSync;

/** ERRAND_DATA_DIR holds the database; unset, it is `data/` at the repo root (gitignored). */
export function databasePath(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string {
  const dir = path.resolve(env.ERRAND_DATA_DIR ?? path.join(cwd, "data"));
  return path.join(dir, "errand.db");
}

/** Opens (creating if needed) the database at `file`; ":memory:" gives a throwaway one for tests. */
export function openDatabase(file: string): Database {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  return db;
}

/** Applies the migrations not yet recorded, in id order. Returns the ids applied by this call. */
export function migrate(db: Database, migrations: readonly Migration[], now: () => Date = () => new Date()): string[] {
  const ids = migrations.map((m) => m.id);
  if (new Set(ids).size !== ids.length) throw new Error(`duplicate migration id in: ${ids.join(", ")}`);
  const applied = new Set(
    (db.prepare("SELECT id FROM schema_migrations").all() as { id: string }[]).map((row) => row.id),
  );
  const pending = [...migrations].sort((a, b) => a.id.localeCompare(b.id)).filter((m) => !applied.has(m.id));
  const record = db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)");
  for (const migration of pending) {
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      record.run(migration.id, now().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return pending.map((m) => m.id);
}
