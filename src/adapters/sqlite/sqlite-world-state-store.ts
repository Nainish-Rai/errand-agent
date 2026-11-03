import type { WorldState, WorldStateStore } from "../world/world-state";
import { migrate, type Database, type Migration } from "./database";

// The mock world's state in the shared SQLite database: one row, replaced on every change. The
// write is synchronous (node:sqlite), so a booking the world made is on disk before `book`
// returns, and a backend killed right after the call still finds it after the restart.

export const WORLD_STATE_MIGRATIONS: readonly Migration[] = [
  {
    id: "0701_world_state",
    sql: `CREATE TABLE world_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state_json TEXT NOT NULL,
      saved_at_ms INTEGER NOT NULL
    );`,
  },
];

export class SqliteWorldStateStore implements WorldStateStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
    migrate(db, WORLD_STATE_MIGRATIONS);
  }

  save(state: WorldState): void {
    this.#db
      .prepare(
        `INSERT INTO world_state (id, state_json, saved_at_ms) VALUES (1, ?, ?)
         ON CONFLICT (id) DO UPDATE SET state_json = excluded.state_json, saved_at_ms = excluded.saved_at_ms`,
      )
      .run(JSON.stringify(state), Date.now());
  }

  load(): WorldState | undefined {
    const row = this.#db.prepare("SELECT state_json FROM world_state WHERE id = 1").get() as { state_json: string } | undefined;
    return row === undefined ? undefined : (JSON.parse(row.state_json) as WorldState);
  }
}
