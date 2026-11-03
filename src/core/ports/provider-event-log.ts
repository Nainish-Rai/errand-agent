import type { CancelledVisit, NoticeSkipReason } from "../provider-events/provider-cancellation";

// Every provider event the backend has received, keyed by the event's own id, so a duplicate
// delivery finds the first one and changes nothing. A notice is claimed per booking too: two
// different events about the same booking can't both tell the person.

export type ProviderEventDecision = "pending" | "skipped" | "notifying" | "notified";

export interface ProviderEventRecord {
  readonly eventId: string;
  readonly bookingId: string;
  readonly userId: string;
  readonly receivedAtMs: number;
  /** How many times the event arrived. */
  readonly deliveries: number;
  readonly decision: ProviderEventDecision;
  readonly skipReason?: NoticeSkipReason;
  /** The chat the notice went to, once one was chosen. */
  readonly sessionId?: string;
  readonly visit?: CancelledVisit;
  readonly notifiedAtMs?: number;
}

export interface ReceivedEvent {
  /** True for the first delivery of this event id. */
  readonly first: boolean;
  readonly record: ProviderEventRecord;
}

export interface ProviderEventLog {
  /** Records the event, or counts one more delivery of an event already recorded. Atomic. */
  receive(event: { readonly eventId: string; readonly bookingId: string; readonly userId: string; readonly atMs: number }): Promise<ReceivedEvent>;
  skip(eventId: string, reason: NoticeSkipReason): Promise<void>;
  /** True when another event already holds (or delivered) the notice for this booking. */
  isBookingNotified(bookingId: string, exceptEventId: string): Promise<boolean>;
  /**
   * Claims the booking's one notice for this event and records where it goes. False when another
   * event claimed it first; true again for the same event (a redelivery resuming its notice).
   */
  claimNotice(eventId: string, notice: { readonly sessionId: string; readonly visit: CancelledVisit; readonly atMs: number }): Promise<boolean>;
  /** The notice reached the person's chat. */
  markNotified(eventId: string, atMs: number): Promise<void>;
  findEvent(eventId: string): Promise<ProviderEventRecord | undefined>;
  /** Dev only: a scenario switch reseeds the world, whose booking ids the old events name. */
  discardAll(): Promise<void>;
}
