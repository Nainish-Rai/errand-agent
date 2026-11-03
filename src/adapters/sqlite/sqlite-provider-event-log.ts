import type { AlertFeed, ProviderAlert } from "../../core/ports/alert-feed";
import type { ProviderEventDecision, ProviderEventLog, ProviderEventRecord, ReceivedEvent } from "../../core/ports/provider-event-log";
import type { ServiceKind } from "../../core/ports/provider-world";
import type { CancelledVisit, NoticeSkipReason } from "../../core/provider-events/provider-cancellation";
import { migrate, type Database, type Migration } from "./database";

// Provider events in the shared SQLite database (ticket 14). The event id is the primary key, so a
// redelivered event lands on the row the first delivery wrote; a partial unique index lets only one
// event per booking hold a notice, so two events about one cancellation can't both reach the person.
// The notices that went out are the provider alerts the home screen shows.

export const PROVIDER_EVENT_MIGRATIONS: readonly Migration[] = [
  {
    id: "1400_provider_events",
    sql: `CREATE TABLE provider_events (
      event_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind = 'provider_cancelled'),
      booking_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      received_at_ms INTEGER NOT NULL,
      deliveries INTEGER NOT NULL,
      decision TEXT NOT NULL CHECK (decision IN ('pending', 'skipped', 'notifying', 'notified')),
      skip_reason TEXT,
      session_id TEXT,
      provider_id TEXT,
      provider_name TEXT,
      service TEXT,
      slot_start TEXT,
      slot_end TEXT,
      price_inr INTEGER,
      noticed_at_ms INTEGER,
      notified_at_ms INTEGER
    );
    CREATE UNIQUE INDEX provider_events_one_notice_per_booking ON provider_events (booking_id)
      WHERE decision IN ('notifying', 'notified');
    CREATE INDEX provider_events_by_user ON provider_events (user_id, decision);`,
  },
];

interface EventRow {
  event_id: string;
  booking_id: string;
  user_id: string;
  received_at_ms: number;
  deliveries: number;
  decision: string;
  skip_reason: string | null;
  session_id: string | null;
  provider_id: string | null;
  provider_name: string | null;
  service: string | null;
  slot_start: string | null;
  slot_end: string | null;
  price_inr: number | null;
  noticed_at_ms: number | null;
  notified_at_ms: number | null;
}

function visitOf(row: EventRow): CancelledVisit | undefined {
  if (row.provider_id === null || row.provider_name === null || row.service === null || row.slot_start === null || row.slot_end === null) {
    return undefined;
  }
  return {
    bookingId: row.booking_id,
    providerId: row.provider_id,
    providerName: row.provider_name,
    service: row.service as ServiceKind,
    slot: { start: row.slot_start, end: row.slot_end },
    priceInr: row.price_inr ?? 0,
  };
}

function recordOf(row: EventRow): ProviderEventRecord {
  const visit = visitOf(row);
  return {
    eventId: row.event_id,
    bookingId: row.booking_id,
    userId: row.user_id,
    receivedAtMs: row.received_at_ms,
    deliveries: row.deliveries,
    decision: row.decision as ProviderEventDecision,
    ...(row.skip_reason === null ? {} : { skipReason: row.skip_reason as NoticeSkipReason }),
    ...(row.session_id === null ? {} : { sessionId: row.session_id }),
    ...(visit === undefined ? {} : { visit }),
    ...(row.notified_at_ms === null ? {} : { notifiedAtMs: row.notified_at_ms }),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/.test(error.message);
}

export class SqliteProviderEventLog implements ProviderEventLog, AlertFeed {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
    migrate(db, PROVIDER_EVENT_MIGRATIONS);
  }

  async receive(event: { readonly eventId: string; readonly bookingId: string; readonly userId: string; readonly atMs: number }): Promise<ReceivedEvent> {
    const inserted = this.#db
      .prepare(
        `INSERT INTO provider_events (event_id, kind, booking_id, user_id, received_at_ms, deliveries, decision)
         VALUES (?, 'provider_cancelled', ?, ?, ?, 1, 'pending')
         ON CONFLICT (event_id) DO UPDATE SET deliveries = deliveries + 1`,
      )
      .run(event.eventId, event.bookingId, event.userId, event.atMs);
    const record = await this.findEvent(event.eventId);
    if (record === undefined) throw new Error(`Provider event ${event.eventId} was neither stored nor found.`);
    // `changes` is 1 for an insert and for the update alike, so the delivery count tells them apart.
    return { first: Number(inserted.changes) === 1 && record.deliveries === 1, record };
  }

  async skip(eventId: string, reason: NoticeSkipReason): Promise<void> {
    this.#db
      .prepare(`UPDATE provider_events SET decision = 'skipped', skip_reason = ? WHERE event_id = ? AND decision IN ('pending', 'notifying')`)
      .run(reason, eventId);
  }

  async isBookingNotified(bookingId: string, exceptEventId: string): Promise<boolean> {
    const row = this.#db
      .prepare(`SELECT 1 FROM provider_events WHERE booking_id = ? AND event_id <> ? AND decision IN ('notifying', 'notified')`)
      .get(bookingId, exceptEventId);
    return row !== undefined;
  }

  async claimNotice(eventId: string, notice: { readonly sessionId: string; readonly visit: CancelledVisit; readonly atMs: number }): Promise<boolean> {
    const { visit } = notice;
    try {
      const result = this.#db
        .prepare(
          `UPDATE provider_events SET decision = 'notifying', session_id = ?, provider_id = ?, provider_name = ?, service = ?,
             slot_start = ?, slot_end = ?, price_inr = ?, noticed_at_ms = COALESCE(noticed_at_ms, ?)
           WHERE event_id = ? AND decision IN ('pending', 'notifying')`,
        )
        .run(notice.sessionId, visit.providerId, visit.providerName, visit.service, visit.slot.start, visit.slot.end, visit.priceInr, notice.atMs, eventId);
      return Number(result.changes) === 1;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async markNotified(eventId: string, atMs: number): Promise<void> {
    this.#db
      .prepare(`UPDATE provider_events SET decision = 'notified', notified_at_ms = COALESCE(notified_at_ms, ?) WHERE event_id = ? AND decision IN ('notifying', 'notified')`)
      .run(atMs, eventId);
  }

  async findEvent(eventId: string): Promise<ProviderEventRecord | undefined> {
    const row = this.#db.prepare("SELECT * FROM provider_events WHERE event_id = ?").get(eventId) as EventRow | undefined;
    return row === undefined ? undefined : recordOf(row);
  }

  async listAlerts(userId: string): Promise<readonly ProviderAlert[]> {
    const rows = this.#db
      .prepare(`SELECT * FROM provider_events WHERE user_id = ? AND decision IN ('notifying', 'notified') ORDER BY noticed_at_ms DESC, event_id DESC`)
      .all(userId) as unknown as EventRow[];
    return rows.flatMap((row): ProviderAlert[] => {
      const visit = visitOf(row);
      if (visit === undefined) return [];
      return [
        {
          kind: "provider_cancelled",
          alertId: `alert_${row.event_id}`,
          bookingId: visit.bookingId,
          providerName: visit.providerName,
          service: visit.service,
          slot: visit.slot,
          raisedAtMs: row.noticed_at_ms ?? row.received_at_ms,
          ...(row.session_id === null ? {} : { sessionId: row.session_id }),
        },
      ];
    });
  }

  async discardAll(): Promise<void> {
    this.#db.exec("DELETE FROM provider_events;");
  }
}
