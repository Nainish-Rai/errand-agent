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
  // Ticket 10: cancellations and reschedules are intents too. They rest on a booking, not a hold, so
  // the hold columns become optional, and they name the booking they change (and a reschedule its
  // new slot). SQLite can't relax NOT NULL in place, so the table is rebuilt with every row kept.
  {
    id: "1000_action_intents_for_booking_changes",
    sql: `CREATE TABLE action_intents_next (
      idempotency_key TEXT PRIMARY KEY,
      action TEXT NOT NULL CHECK (action IN ('book', 'cancel', 'reschedule')),
      proposal_id TEXT NOT NULL,
      grant_id TEXT NOT NULL UNIQUE,
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      hold_id TEXT,
      hold_expires_at TEXT,
      target_booking_id TEXT,
      new_slot_start TEXT,
      new_slot_end TEXT,
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
      seq INTEGER NOT NULL,
      CHECK ((action = 'book') = (hold_id IS NOT NULL AND hold_expires_at IS NOT NULL)),
      CHECK ((action = 'book') = (target_booking_id IS NULL)),
      CHECK ((action = 'reschedule') = (new_slot_start IS NOT NULL AND new_slot_end IS NOT NULL))
    );
    INSERT INTO action_intents_next (idempotency_key, action, proposal_id, grant_id, session_id, user_id, hold_id,
      hold_expires_at, state, attempts, version, created_at_ms, updated_at_ms, last_attempt_at_ms, booking_id,
      failure_reason, resolved_at_ms, resolved_by, notice_delivered_at_ms, seq)
    SELECT idempotency_key, action, proposal_id, grant_id, session_id, user_id, hold_id, hold_expires_at, state,
      attempts, version, created_at_ms, updated_at_ms, last_attempt_at_ms, booking_id, failure_reason, resolved_at_ms,
      resolved_by, notice_delivered_at_ms, seq
    FROM action_intents;
    DROP TABLE action_intents;
    ALTER TABLE action_intents_next RENAME TO action_intents;
    CREATE INDEX action_intents_by_session ON action_intents (session_id, seq);
    CREATE INDEX action_intents_unresolved ON action_intents (state) WHERE state IN ('pending', 'unknown');
    CREATE UNIQUE INDEX action_intents_by_booking ON action_intents (booking_id) WHERE booking_id IS NOT NULL;`,
  },
];

interface IntentRow {
  idempotency_key: string;
  action: string;
  proposal_id: string;
  grant_id: string;
  session_id: string;
  user_id: string;
  hold_id: string | null;
  hold_expires_at: string | null;
  target_booking_id: string | null;
  new_slot_start: string | null;
  new_slot_end: string | null;
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

function required(row: IntentRow, column: keyof IntentRow): string {
  const value = row[column];
  if (typeof value !== "string") throw new Error(`Intent ${row.idempotency_key} (${row.action}) has no ${column}.`);
  return value;
}

function intentFrom(row: IntentRow): ActionIntent {
  const record = recordFrom(row);
  switch (row.action) {
    case "book":
      return {
        ...record,
        action: "book",
        holdId: required(row, "hold_id"),
        holdExpiresAt: required(row, "hold_expires_at"),
        ...optional("bookingId", row.booking_id),
      };
    case "cancel":
      return { ...record, action: "cancel", targetBookingId: required(row, "target_booking_id") };
    case "reschedule":
      return {
        ...record,
        action: "reschedule",
        targetBookingId: required(row, "target_booking_id"),
        newSlot: { start: required(row, "new_slot_start"), end: required(row, "new_slot_end") },
      };
    default:
      throw new Error(`Intent ${row.idempotency_key} has an unknown action ${row.action}.`);
  }
}

function recordFrom(row: IntentRow) {
  return {
    idempotencyKey: row.idempotency_key,
    proposalId: row.proposal_id,
    grantId: row.grant_id,
    sessionId: row.session_id,
    userId: row.user_id,
    state: row.state as ActionIntentState,
    attempts: row.attempts,
    version: row.version,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    ...optional("lastAttemptAtMs", row.last_attempt_at_ms),
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

  async record<T extends ActionIntent>(intent: T): Promise<T> {
    const written: ActionIntent = intent;
    const hold = written.action === "book" ? written : undefined;
    const change = written.action === "book" ? undefined : written;
    const newSlot = written.action === "reschedule" ? written.newSlot : undefined;
    this.#db
      .prepare(
        `INSERT INTO action_intents (idempotency_key, action, proposal_id, grant_id, session_id, user_id, hold_id, hold_expires_at,
           target_booking_id, new_slot_start, new_slot_end, state, attempts, version, created_at_ms, updated_at_ms, seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM action_intents))
         ON CONFLICT (idempotency_key) DO NOTHING`,
      )
      .run(
        intent.idempotencyKey,
        intent.action,
        intent.proposalId,
        intent.grantId,
        intent.sessionId,
        intent.userId,
        hold?.holdId ?? null,
        hold?.holdExpiresAt ?? null,
        change?.targetBookingId ?? null,
        newSlot?.start ?? null,
        newSlot?.end ?? null,
        intent.state,
        intent.attempts,
        intent.version,
        intent.createdAtMs,
        intent.updatedAtMs,
      );
    const stored = await this.find(intent.idempotencyKey);
    if (stored === undefined) throw new Error(`Intent ${intent.idempotencyKey} was neither stored nor found.`);
    if (stored.action !== intent.action) throw new Error(`Intent ${intent.idempotencyKey} is stored as ${stored.action}.`);
    return stored as T;
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
        (next.action === "book" ? next.bookingId : undefined) ?? null,
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
