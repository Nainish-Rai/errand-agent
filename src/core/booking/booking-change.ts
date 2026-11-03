import type { Booking, CancelOutcome, RescheduleOutcome, Slot } from "../ports/provider-world";
import { canAttemptAgain, type BookingChangeIntent } from "./action-intent";

// The rules for changing a booking that already exists: which bookings can still change, and the
// reconciliation matrix for a cancel or a reschedule. The status is the booking as the world lists
// it (`list_bookings`), never the call's own reply: a cancellation is confirmed only once the
// booking reads cancelled, a reschedule only once the booking sits at the new slot. A 503 says the
// call didn't get through, so the same request is sent again with the same key, at most
// MAX_BOOK_ATTEMPTS times in all; the world turns a repeated key into the first result.

/** An upcoming booking whose visit hasn't started: the only kind a person can cancel or move. */
export function isChangeable(booking: Booking, nowMs: number): boolean {
  return booking.status === "upcoming" && Date.parse(booking.slot.start) > nowMs;
}

export function isSameSlot(a: Slot, b: Slot): boolean {
  return Date.parse(a.start) === Date.parse(b.start);
}

/** Whether the world's booking already shows the change. */
export function showsChange(intent: BookingChangeIntent, booking: Booking): boolean {
  if (intent.action === "cancel") return booking.status === "cancelled";
  return booking.status === "upcoming" && isSameSlot(booking.slot, intent.newSlot);
}

export type ChangeSettlement =
  /** The world's booking shows the change. */
  | { readonly kind: "confirm" }
  /** The world refused it (`slot_conflict`), or it can no longer happen (the booking is gone, or attempts ran out). */
  | { readonly kind: "fail"; readonly reason: string }
  /** The booking doesn't show the change yet, and the same request may be sent again with the same key. */
  | { readonly kind: "retry" };

/** What a `cancel` or `reschedule` reply means before the status is read. */
export type ChangeReplyReading = { readonly kind: "check_status" } | { readonly kind: "fail"; readonly reason: string };

export function readCancelReply(reply: CancelOutcome): ChangeReplyReading {
  switch (reply.kind) {
    case "cancelled":
    // A 503 didn't get through; the status says whether an earlier attempt did.
    case "service_unavailable":
    // A repeated key after an earlier attempt cancelled it reads as not found: the status decides.
    case "booking_not_found":
      return { kind: "check_status" };
    // The same key with a different request: a bug on our side, never retried.
    case "idempotency_conflict":
      return { kind: "fail", reason: "idempotency_conflict" };
  }
}

export function readRescheduleReply(reply: RescheduleOutcome): ChangeReplyReading {
  switch (reply.kind) {
    case "rescheduled":
    case "booking_not_found":
      return { kind: "check_status" };
    // The provider can't take the new slot. Retrying the same slot won't change that: other slots will.
    case "slot_conflict":
      return { kind: "fail", reason: "slot_conflict" };
    case "idempotency_conflict":
      return { kind: "fail", reason: "idempotency_conflict" };
  }
}

/**
 * Settles the change from the booking the world lists now (undefined when it lists none with that
 * ID). `lastReply` is the reply of this pass's call, if one was sent: when no attempt is left, it
 * says why the change didn't happen.
 */
export function settleChangeFromStatus(intent: BookingChangeIntent, booking: Booking | undefined, lastReply?: string): ChangeSettlement {
  if (booking === undefined) return { kind: "fail", reason: "booking_not_found" };
  if (showsChange(intent, booking)) return { kind: "confirm" };
  // Completed, or cancelled by someone else while a move was pending: nothing left to change.
  if (booking.status !== "upcoming") return { kind: "fail", reason: "booking_not_changeable" };
  if (canAttemptAgain(intent)) return { kind: "retry" };
  return { kind: "fail", reason: lastReply === "service_unavailable" ? "service_unavailable" : "not_applied" };
}

/** Up to `count` of `slots`, the ones closest in time to `wanted` first (earlier first on a tie). */
export function closestSlots(slots: readonly Slot[], wanted: Slot, count: number): Slot[] {
  const at = Date.parse(wanted.start);
  const distance = (slot: Slot) => Math.abs(Date.parse(slot.start) - at);
  return slots
    .filter((slot) => !isSameSlot(slot, wanted))
    .toSorted((a, b) => distance(a) - distance(b) || Date.parse(a.start) - Date.parse(b.start))
    .slice(0, count);
}
