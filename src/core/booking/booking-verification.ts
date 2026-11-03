import type { BookingStatusOutcome, BookOutcome } from "../ports/provider-world";

// What `book` returned, checked against what `get_booking_status` says for the same idempotency
// key. The status is the source of truth: a timeout can hide a booking that was made, and a
// "booked" reply is believed only once the status confirms the same booking ID.

export type BookingVerification =
  | { readonly kind: "verified"; readonly bookingId: string }
  | { readonly kind: "slot_taken" }
  /** The world can't say yet whether the booking exists. Never reported as booked or as failed. */
  | { readonly kind: "unverified" }
  | { readonly kind: "failed"; readonly reason: string };

/** Whether `book`'s reply needs the status check (anything that may have booked does). */
export function needsStatusCheck(booked: BookOutcome): boolean {
  return booked.kind === "booked" || booked.kind === "timeout";
}

export function verifyBooking(booked: BookOutcome, status: BookingStatusOutcome | undefined): BookingVerification {
  if (booked.kind === "slot_taken") return { kind: "slot_taken" };
  if (!needsStatusCheck(booked)) return { kind: "failed", reason: booked.kind };
  if (status === undefined || status.kind === "not_found") return { kind: "unverified" };
  if (status.kind === "failed") return status.reason === "slot_taken" ? { kind: "slot_taken" } : { kind: "failed", reason: status.reason };
  if (booked.kind === "booked" && booked.bookingId !== status.bookingId) return { kind: "failed", reason: "verification_mismatch" };
  return { kind: "verified", bookingId: status.bookingId };
}
