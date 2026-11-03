import type { ErrandHandoff, HandoffOrigin, MovedHandoff } from "../../core/errand/errand-handoff";
import type { ErrandHandoffStore } from "../../core/ports/errand-handoff-store";
import type { ServiceKind } from "../../core/ports/provider-world";
import { migrate, type Database, type Migration } from "./database";

// New errand cards and where their jobs went (ticket 24), in the shared SQLite database. One row
// per card: (chat, refused search) is the primary key and a settlement never overwrites, so the
// first tap wins. A chat can be started by one move only, so the new chat's id is unique too.

export const ERRAND_HANDOFF_MIGRATIONS: readonly Migration[] = [
  {
    id: "2400_errand_handoffs",
    sql: `CREATE TABLE errand_handoffs (
      from_session_id TEXT NOT NULL,
      tool_call_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('moved', 'dismissed')),
      to_session_id TEXT UNIQUE,
      origin_service TEXT,
      origin_area TEXT,
      settled_at_ms INTEGER NOT NULL,
      PRIMARY KEY (from_session_id, tool_call_id),
      CHECK ((kind = 'moved') = (to_session_id IS NOT NULL))
    );`,
  },
];

interface HandoffRow {
  from_session_id: string;
  tool_call_id: string;
  kind: "moved" | "dismissed";
  to_session_id: string | null;
  origin_service: string | null;
  origin_area: string | null;
  settled_at_ms: number;
}

function originOf(row: HandoffRow): HandoffOrigin {
  return {
    // Written only from an errand's own service, so it is one of the catalog's kinds.
    ...(row.origin_service === null ? {} : { service: row.origin_service as ServiceKind }),
    ...(row.origin_area === null ? {} : { area: row.origin_area }),
  };
}

function handoffOf(row: HandoffRow): ErrandHandoff {
  const card = { fromSessionId: row.from_session_id, toolCallId: row.tool_call_id, settledAtMs: row.settled_at_ms };
  if (row.kind === "dismissed" || row.to_session_id === null) return { kind: "dismissed", ...card };
  return { kind: "moved", ...card, toSessionId: row.to_session_id, origin: originOf(row) };
}

export class SqliteErrandHandoffStore implements ErrandHandoffStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
    migrate(db, ERRAND_HANDOFF_MIGRATIONS);
  }

  async settle(handoff: ErrandHandoff): Promise<ErrandHandoff> {
    const moved = handoff.kind === "moved" ? handoff : undefined;
    // DO NOTHING on either key: the card is settled, or the new chat was already started by another card.
    this.#db
      .prepare(
        `INSERT INTO errand_handoffs (from_session_id, tool_call_id, kind, to_session_id, origin_service, origin_area, settled_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      )
      .run(
        handoff.fromSessionId,
        handoff.toolCallId,
        handoff.kind,
        moved?.toSessionId ?? null,
        moved?.origin.service ?? null,
        moved?.origin.area ?? null,
        handoff.settledAtMs,
      );
    const row = this.#db
      .prepare("SELECT * FROM errand_handoffs WHERE from_session_id = ? AND tool_call_id = ?")
      .get(handoff.fromSessionId, handoff.toolCallId) as HandoffRow | undefined;
    if (row === undefined) throw new Error(`Chat ${moved?.toSessionId ?? ""} was already started by another card.`);
    return handoffOf(row);
  }

  async settledIn(fromSessionId: string): Promise<readonly ErrandHandoff[]> {
    const rows = this.#db
      .prepare("SELECT * FROM errand_handoffs WHERE from_session_id = ? ORDER BY settled_at_ms, tool_call_id")
      .all(fromSessionId) as unknown as HandoffRow[];
    return rows.map(handoffOf);
  }

  async startedIn(toSessionId: string): Promise<MovedHandoff | undefined> {
    const row = this.#db.prepare("SELECT * FROM errand_handoffs WHERE to_session_id = ?").get(toSessionId) as HandoffRow | undefined;
    const handoff = row === undefined ? undefined : handoffOf(row);
    return handoff?.kind === "moved" ? handoff : undefined;
  }
}
