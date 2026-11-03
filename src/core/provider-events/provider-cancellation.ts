import { dayAfter, istDayOf } from "../calendar/ist-day";
import type { ErrandDetails } from "../errand/errand";
import type { MemoryFact } from "../memory/memory-fact";
import type { Booking } from "../ports/provider-world";

// A provider cancelling a booking, as core decides about it. The event only names a booking; what
// happened to that booking is read back from the world, so a forged or stale event can't make the
// agent tell the person something the provider's own books don't say. A notice goes out only when it
// matters to the person: the visit is still ahead of them, the provider (not they) cancelled it, and
// nobody has told them already.

/** Why an event led to no notice. */
export type NoticeSkipReason =
  /** The world has no such booking for this person. */
  | "unknown_booking"
  /** The visit was in the past (or done) when the event arrived. */
  | "past_booking"
  /** The world still has the booking as upcoming: the event says more than the provider's books. */
  | "not_cancelled"
  /** The booking was already cancelled by someone else (the person) before this event. */
  | "already_cancelled"
  /** Another event about the same booking already told the person. */
  | "already_notified";

export type NoticeDecision = { readonly kind: "notify" } | { readonly kind: "skip"; readonly reason: NoticeSkipReason };

/** What the person is told about, read from the world's booking. */
export interface CancelledVisit {
  readonly bookingId: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly service: Booking["service"];
  readonly slot: Booking["slot"];
  readonly priceInr: number;
}

export function decideNotice(booking: Booking | undefined, nowMs: number, alreadyNotified: boolean): NoticeDecision {
  if (booking === undefined) return { kind: "skip", reason: "unknown_booking" };
  if (booking.status === "completed" || Date.parse(booking.slot.start) <= nowMs) return { kind: "skip", reason: "past_booking" };
  if (booking.status === "upcoming") return { kind: "skip", reason: "not_cancelled" };
  if (booking.cancelledBy !== "provider") return { kind: "skip", reason: "already_cancelled" };
  if (alreadyNotified) return { kind: "skip", reason: "already_notified" };
  return { kind: "notify" };
}

export function cancelledVisitOf(booking: Booking): CancelledVisit {
  return {
    bookingId: booking.bookingId,
    providerId: booking.providerId,
    providerName: booking.providerName,
    service: booking.service,
    slot: { start: booking.slot.start, end: booking.slot.end },
    priceInr: booking.priceInr,
  };
}

/** Days searched for a replacement: the cancelled visit's day and the six after it. */
export const REPLACEMENT_WINDOW_DAYS = 7;

const LAST_HOUR = 24;

function valueOf(facts: readonly MemoryFact[], key: MemoryFact["key"]): string | undefined {
  return facts.find((fact) => fact.key === key)?.value;
}

/**
 * The replacement errand's details: the cancelled visit's service, and the person's current saved
 * preferences (usual area, budget, earliest start, standing wishes), only from facts context
 * selection lets the agent use. Without a saved area, the cancelled provider's area is the place
 * the visit was for. The window starts on the cancelled day (never before today) and runs a week.
 */
export function replacementDetails(
  visit: CancelledVisit,
  usableFacts: readonly MemoryFact[],
  fallbackArea: string,
  nowMs: number,
): ErrandDetails {
  const today = istDayOf(nowMs);
  const cancelledDay = istDayOf(Date.parse(visit.slot.start));
  const from = cancelledDay > today ? cancelledDay : today;
  const budget = Number(valueOf(usableFacts, "budget"));
  const earliest = Number(valueOf(usableFacts, "earliest_hour"));
  const hasEarliest = valueOf(usableFacts, "earliest_hour") !== undefined && Number.isInteger(earliest) && earliest >= 0 && earliest < LAST_HOUR;
  const preferences = (valueOf(usableFacts, "preferences") ?? "")
    .split(",")
    .map((wish) => wish.trim())
    .filter(Boolean);
  return {
    service: visit.service,
    area: valueOf(usableFacts, "area") ?? fallbackArea,
    timeWindow: {
      dates: { from, to: dayAfter(from, REPLACEMENT_WINDOW_DAYS - 1) },
      ...(hasEarliest ? { hours: { from: earliest, to: LAST_HOUR } } : {}),
    },
    ...(Number.isFinite(budget) && budget > 0 ? { budget: { maxInr: budget } } : {}),
    preferences,
  };
}
