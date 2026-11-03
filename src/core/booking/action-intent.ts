import type { Grant } from "../approval/grant";
import { idempotencyKeyOf } from "../approval/grant";
import type { BookingChangeProposal, BookingProposal } from "../approval/proposal";
import type { TracePlace } from "../errand/errand-workflow";
import type { Slot } from "../ports/provider-world";
import type { TraceEvent } from "../ports/trace-sink";

// An action intent is the ledger's record of one approved side effect, written before the side
// effect is attempted and keyed by the idempotency key the world sees. It is the outbox of the
// exactly-once rule: whoever finds it unresolved (the execution that wrote it, or the reconciler
// after a timeout, a cut-off run or a crash) settles it against `get_booking_status` with the same
// key, so a booking is made at most once and is reported only once the world confirms it.
//
//   pending ──► confirmed        the world's status names the booking
//      │  ▲ ──► failed           the world refused it, or it can no longer happen
//      ▼  │
//    unknown                     `book` timed out and the status doesn't show it (yet)
//
// A cancellation or a reschedule is an intent too, keyed `cancel:<grantId>` or
// `reschedule:<grantId>`, and settled the same way: its status is the booking as `list_bookings`
// has it, so "cancelled" is said only once the world's booking reads cancelled.

export type ActionIntentState = "pending" | "confirmed" | "failed" | "unknown";

/** `book` (`cancel`, `reschedule`) is sent at most this many times per intent, always with the same key. */
export const MAX_BOOK_ATTEMPTS = 3;

/** Who settled the intent: the execution the person is waiting on, or the reconciler later. */
export type ResolvedBy = "execution" | "reconciler";

interface IntentRecord {
  /** `book:<grantId>` (`cancel:…`, `reschedule:…`): one grant, one key, one effect. */
  readonly idempotencyKey: string;
  readonly proposalId: string;
  readonly grantId: string;
  readonly sessionId: string;
  readonly userId: string;
  readonly state: ActionIntentState;
  /** How many times `book` was sent. Counted before each send, so a crash mid-call still counts. */
  readonly attempts: number;
  /** Bumped on every change; the ledger saves a change only over the version it was made from. */
  readonly version: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly lastAttemptAtMs?: number;
  /** Set once failed: `slot_taken`, `hold_expired`, `service_unavailable`, `slot_conflict`, … */
  readonly failureReason?: string;
  readonly resolvedAtMs?: number;
  readonly resolvedBy?: ResolvedBy;
  /** When the person was told about a resolution the reconciler reached outside their turn. */
  readonly noticeDeliveredAtMs?: number;
}

export interface BookingIntent extends IntentRecord {
  readonly action: "book";
  readonly holdId: string;
  /** When the hold behind the intent runs out; after that `book` can't succeed. */
  readonly holdExpiresAt: string;
  /** Set once confirmed: the booking ID the world's status gave for the key. */
  readonly bookingId?: string;
}

export interface CancellationIntent extends IntentRecord {
  readonly action: "cancel";
  /** The booking to cancel. */
  readonly targetBookingId: string;
}

export interface RescheduleIntent extends IntentRecord {
  readonly action: "reschedule";
  /** The booking to move. */
  readonly targetBookingId: string;
  readonly newSlot: Slot;
}

export type BookingChangeIntent = CancellationIntent | RescheduleIntent;

export type ActionIntent = BookingIntent | BookingChangeIntent;

export function isBookingIntent(intent: ActionIntent): intent is BookingIntent {
  return intent.action === "book";
}

function recordFor(proposal: BookingProposal | BookingChangeProposal, grant: Grant, atMs: number): IntentRecord {
  return {
    idempotencyKey: idempotencyKeyOf(grant, proposal.terms.action),
    proposalId: proposal.proposalId,
    grantId: grant.grantId,
    sessionId: proposal.sessionId,
    userId: proposal.userId,
    state: "pending",
    attempts: 0,
    version: 1,
    createdAtMs: atMs,
    updatedAtMs: atMs,
  };
}

/** The intent of carrying out an approved cancellation or reschedule, recorded before the first call. */
export function bookingChangeIntentFor(proposal: BookingChangeProposal, grant: Grant, atMs: number): BookingChangeIntent {
  const record = recordFor(proposal, grant, atMs);
  const { terms } = proposal;
  return terms.action === "cancel"
    ? { ...record, action: "cancel", targetBookingId: terms.bookingId }
    : { ...record, action: "reschedule", targetBookingId: terms.bookingId, newSlot: { start: terms.slot.start, end: terms.slot.end } };
}

export function bookingIntentFor(proposal: BookingProposal, grant: Grant, atMs: number): BookingIntent {
  return {
    ...recordFor(proposal, grant, atMs),
    action: "book",
    holdId: proposal.terms.holdId,
    holdExpiresAt: proposal.terms.holdExpiresAt,
  };
}

export function isResolved(intent: ActionIntent): boolean {
  return intent.state === "confirmed" || intent.state === "failed";
}

export function canAttemptAgain(intent: ActionIntent): boolean {
  return !isResolved(intent) && intent.attempts < MAX_BOOK_ATTEMPTS;
}

/** Whether the hold behind the intent has run out by the world's clock, so `book` can't succeed any more. */
export function isHoldOver(intent: BookingIntent, worldNowMs: number): boolean {
  return worldNowMs > Date.parse(intent.holdExpiresAt);
}

/** A reconciler's resolution the person hasn't been told about yet. */
export function awaitsNotice(intent: ActionIntent): boolean {
  return isResolved(intent) && intent.resolvedBy === "reconciler" && intent.noticeDeliveredAtMs === undefined;
}

function changed<T extends ActionIntent>(intent: T, atMs: number, change: Partial<IntentRecord> & { readonly bookingId?: string }): T {
  return { ...intent, ...change, version: intent.version + 1, updatedAtMs: atMs };
}

function assertUnresolved(intent: ActionIntent, what: string): void {
  if (isResolved(intent)) throw new Error(`Intent ${intent.idempotencyKey} is ${intent.state}; it can't be ${what}.`);
}

/** About to send `book` (again): counted first, so the ledger knows a call may be in flight. */
export function attemptStarted<T extends ActionIntent>(intent: T, atMs: number): T {
  assertUnresolved(intent, "attempted");
  if (!canAttemptAgain(intent)) throw new Error(`Intent ${intent.idempotencyKey} has used its ${MAX_BOOK_ATTEMPTS} attempts.`);
  return changed(intent, atMs, { state: "pending", attempts: intent.attempts + 1, lastAttemptAtMs: atMs });
}

export function confirmedAs(intent: BookingIntent, bookingId: string, by: ResolvedBy, atMs: number): BookingIntent {
  assertUnresolved(intent, "confirmed");
  return changed(intent, atMs, { state: "confirmed", bookingId, resolvedAtMs: atMs, resolvedBy: by });
}

/** The world's booking shows the change took effect: it reads cancelled, or it is at the new slot. */
export function changeConfirmed(intent: BookingChangeIntent, by: ResolvedBy, atMs: number): BookingChangeIntent {
  assertUnresolved(intent, "confirmed");
  return changed(intent, atMs, { state: "confirmed", resolvedAtMs: atMs, resolvedBy: by });
}

export function failedWith<T extends ActionIntent>(intent: T, reason: string, by: ResolvedBy, atMs: number): T {
  assertUnresolved(intent, "failed");
  return changed(intent, atMs, { state: "failed", failureReason: reason, resolvedAtMs: atMs, resolvedBy: by });
}

/** `book` was answered with a timeout: nobody knows whether it booked until the status says. */
export function unknownAfterTimeout<T extends ActionIntent>(intent: T, atMs: number): T {
  assertUnresolved(intent, "marked unknown");
  return changed(intent, atMs, { state: "unknown" });
}

export function noticeDelivered<T extends ActionIntent>(intent: T, atMs: number): T {
  return changed(intent, atMs, { noticeDeliveredAtMs: atMs });
}

/** A change of the intent's state (or a new attempt) as a `ledger_transition` event of the run trace. */
export function ledgerEvent(before: ActionIntent | undefined, after: ActionIntent, place: TracePlace): TraceEvent {
  const from = before?.state ?? "recorded";
  return {
    type: "event",
    traceId: place.traceId,
    eventId: `ledger:${after.idempotencyKey}:${after.version}`,
    sessionId: place.sessionId,
    ...(place.spanId === undefined ? {} : { spanId: place.spanId }),
    kind: "ledger_transition",
    name: `ledger ${from} → ${after.state}`,
    timeMs: after.updatedAtMs,
    attributes: {
      "errand.ledger.key": after.idempotencyKey,
      "errand.ledger.action": after.action,
      "errand.ledger.state.from": before?.state ?? null,
      "errand.ledger.state.to": after.state,
      "errand.ledger.attempts": after.attempts,
      "errand.ledger.booking_id": (after.action === "book" ? after.bookingId : after.targetBookingId) ?? null,
      "errand.ledger.failure_reason": after.failureReason ?? null,
      "errand.ledger.resolved_by": after.resolvedBy ?? null,
      "errand.proposal.id": after.proposalId,
    },
  };
}
