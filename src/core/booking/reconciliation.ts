import type { BookingStatusOutcome, BookOutcome } from "../ports/provider-world";
import { canAttemptAgain, isHoldOver, type ActionIntent } from "./action-intent";

// The reconciliation matrix: what to do with an intent given what the world said. The world's
// `get_booking_status` for the intent's key is the source of truth. `book`'s own reply is never
// believed on its own, because a timeout can hide a booking that was made and a retry with the
// same key replays the first result.
//
// The order is the one UCP and ACP use for an ambiguous call: re-check the status with the same
// key first, and only when the world has no record of the key send the same request again with
// the same key, which the world turns into the original result if the first one landed after all.

export type Settlement =
  /** The status names the booking. */
  | { readonly kind: "confirm"; readonly bookingId: string }
  /** The world refused it (`slot_taken`), or it can no longer happen (the hold ran out). */
  | { readonly kind: "fail"; readonly reason: string }
  /** The world has no record of the key and `book` may be sent again with it. */
  | { readonly kind: "retry" }
  /** The world has no record of the key, and no attempt is left for now. Never booked, never failed. */
  | { readonly kind: "unknown" };

/** What `book`'s reply means before the status is read. */
export type BookReplyReading =
  /** Read the status: the call may have booked (a reply of `booked` is checked too). */
  | { readonly kind: "check_status" }
  | { readonly kind: "fail"; readonly reason: string };

export function readBookReply(reply: BookOutcome): BookReplyReading {
  switch (reply.kind) {
    case "booked":
    case "timeout":
    // A repeated key whose hold was spent by an earlier attempt of the same key: that attempt
    // may have booked, so the status decides.
    case "hold_not_found":
    case "hold_expired":
      return { kind: "check_status" };
    case "slot_taken":
      return { kind: "fail", reason: "slot_taken" };
    // The same key with a different request (ACP's 422): a bug on our side, never retried.
    case "idempotency_conflict":
      return { kind: "fail", reason: "idempotency_conflict" };
  }
}

export interface StatusContext {
  /** The world's time, which the hold's expiry is measured by. */
  readonly worldNowMs: number;
  /** What `book` itself replied in this attempt, when there was one. */
  readonly reply?: BookOutcome;
}

/** Settles the intent from the status the world gave for its key. */
export function settleFromStatus(intent: ActionIntent, status: BookingStatusOutcome, context: StatusContext): Settlement {
  if (status.kind === "booked") {
    // A `booked` reply naming another booking than the status does is believed by neither.
    if (context.reply?.kind === "booked" && context.reply.bookingId !== status.bookingId) return { kind: "unknown" };
    return { kind: "confirm", bookingId: status.bookingId };
  }
  if (status.kind === "failed") return { kind: "fail", reason: status.reason };
  if (context.reply?.kind === "hold_expired" || context.reply?.kind === "hold_not_found") return { kind: "fail", reason: context.reply.kind };
  if (isHoldOver(intent, context.worldNowMs)) return { kind: "fail", reason: "hold_expired" };
  return canAttemptAgain(intent) ? { kind: "retry" } : { kind: "unknown" };
}
