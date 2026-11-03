import type { Grant } from "../approval/grant";
import { idempotencyKeyOf } from "../approval/grant";
import type { Proposal } from "../approval/proposal";
import type { TracePlace } from "../errand/errand-workflow";
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

export type ActionIntentState = "pending" | "confirmed" | "failed" | "unknown";

/** `book` is sent at most this many times per intent, always with the same key. */
export const MAX_BOOK_ATTEMPTS = 3;

/** Who settled the intent: the execution the person is waiting on, or the reconciler later. */
export type ResolvedBy = "execution" | "reconciler";

export interface ActionIntent {
  /** `book:<grantId>`: one grant, one key, one booking. */
  readonly idempotencyKey: string;
  readonly action: "book";
  readonly proposalId: string;
  readonly grantId: string;
  readonly sessionId: string;
  readonly userId: string;
  readonly holdId: string;
  /** When the hold behind the intent runs out; after that `book` can't succeed. */
  readonly holdExpiresAt: string;
  readonly state: ActionIntentState;
  /** How many times `book` was sent. Counted before each send, so a crash mid-call still counts. */
  readonly attempts: number;
  /** Bumped on every change; the ledger saves a change only over the version it was made from. */
  readonly version: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly lastAttemptAtMs?: number;
  /** Set once confirmed: the booking ID the world's status gave for the key. */
  readonly bookingId?: string;
  /** Set once failed: `slot_taken`, `hold_expired`, `idempotency_conflict`, … */
  readonly failureReason?: string;
  readonly resolvedAtMs?: number;
  readonly resolvedBy?: ResolvedBy;
  /** When the person was told about a resolution the reconciler reached outside their turn. */
  readonly noticeDeliveredAtMs?: number;
}

export function bookingIntentFor(proposal: Proposal, grant: Grant, atMs: number): ActionIntent {
  return {
    idempotencyKey: idempotencyKeyOf(grant),
    action: "book",
    proposalId: proposal.proposalId,
    grantId: grant.grantId,
    sessionId: proposal.sessionId,
    userId: proposal.userId,
    holdId: proposal.terms.holdId,
    holdExpiresAt: proposal.terms.holdExpiresAt,
    state: "pending",
    attempts: 0,
    version: 1,
    createdAtMs: atMs,
    updatedAtMs: atMs,
  };
}

export function isResolved(intent: ActionIntent): boolean {
  return intent.state === "confirmed" || intent.state === "failed";
}

export function canAttemptAgain(intent: ActionIntent): boolean {
  return !isResolved(intent) && intent.attempts < MAX_BOOK_ATTEMPTS;
}

/** Whether the hold behind the intent has run out by the world's clock, so `book` can't succeed any more. */
export function isHoldOver(intent: ActionIntent, worldNowMs: number): boolean {
  return worldNowMs > Date.parse(intent.holdExpiresAt);
}

/** A reconciler's resolution the person hasn't been told about yet. */
export function awaitsNotice(intent: ActionIntent): boolean {
  return isResolved(intent) && intent.resolvedBy === "reconciler" && intent.noticeDeliveredAtMs === undefined;
}

function changed(intent: ActionIntent, atMs: number, change: Partial<ActionIntent>): ActionIntent {
  return { ...intent, ...change, version: intent.version + 1, updatedAtMs: atMs };
}

function assertUnresolved(intent: ActionIntent, what: string): void {
  if (isResolved(intent)) throw new Error(`Intent ${intent.idempotencyKey} is ${intent.state}; it can't be ${what}.`);
}

/** About to send `book` (again): counted first, so the ledger knows a call may be in flight. */
export function attemptStarted(intent: ActionIntent, atMs: number): ActionIntent {
  assertUnresolved(intent, "attempted");
  if (!canAttemptAgain(intent)) throw new Error(`Intent ${intent.idempotencyKey} has used its ${MAX_BOOK_ATTEMPTS} attempts.`);
  return changed(intent, atMs, { state: "pending", attempts: intent.attempts + 1, lastAttemptAtMs: atMs });
}

export function confirmedAs(intent: ActionIntent, bookingId: string, by: ResolvedBy, atMs: number): ActionIntent {
  assertUnresolved(intent, "confirmed");
  return changed(intent, atMs, { state: "confirmed", bookingId, resolvedAtMs: atMs, resolvedBy: by });
}

export function failedWith(intent: ActionIntent, reason: string, by: ResolvedBy, atMs: number): ActionIntent {
  assertUnresolved(intent, "failed");
  return changed(intent, atMs, { state: "failed", failureReason: reason, resolvedAtMs: atMs, resolvedBy: by });
}

/** `book` was answered with a timeout: nobody knows whether it booked until the status says. */
export function unknownAfterTimeout(intent: ActionIntent, atMs: number): ActionIntent {
  assertUnresolved(intent, "marked unknown");
  return changed(intent, atMs, { state: "unknown" });
}

export function noticeDelivered(intent: ActionIntent, atMs: number): ActionIntent {
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
      "errand.ledger.state.from": before?.state ?? null,
      "errand.ledger.state.to": after.state,
      "errand.ledger.attempts": after.attempts,
      "errand.ledger.booking_id": after.bookingId ?? null,
      "errand.ledger.failure_reason": after.failureReason ?? null,
      "errand.ledger.resolved_by": after.resolvedBy ?? null,
      "errand.proposal.id": after.proposalId,
    },
  };
}
