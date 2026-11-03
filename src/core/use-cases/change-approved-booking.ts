import { fingerprintOf, matchesFingerprint } from "../approval/fingerprint";
import { isConsumed, isGrantExpired, type Grant } from "../approval/grant";
import { termChangesBetween, type TermChange } from "../approval/invalidation";
import {
  cancellationTermsOf,
  proposeChange,
  proposeTerms,
  rescheduleTermsOf,
  type BookingChangeProposal,
  type BookingChangeTerms,
  type CancellationTerms,
  type Proposal,
  type ProposalOf,
  type RescheduleTerms,
} from "../approval/proposal";
import { bookingChangeIntentFor, isResolved, ledgerEvent, type BookingChangeIntent } from "../booking/action-intent";
import { isCancelledByProvider, isChangeable } from "../booking/booking-change";
import type { TracePlace } from "../errand/errand-workflow";
import type { Slot } from "../ports/provider-world";
import { ledgerDependenciesOf, type BookingDependencies } from "./book-approved-proposal";
import { alternativesTo, bookingOf } from "./booking-change-session";
import { settleBookingChange } from "./settle-booking-change";

// Carrying out an approved cancellation or reschedule: the same path as a booking. The card's
// proposal must have a grant from a tap on Approve for exactly its fingerprint; the live booking
// and fee are re-read first, and any difference voids the grant and puts a fresh card up. Then the
// ledger records the intent (keyed by the grant), the grant is used once, and the change is sent
// with the grant's key and settled from the booking's status. "Cancelled" and "Moved" are said only
// once `list_bookings` shows it.

export type BookingChangeOutcome =
  /** The booking now reads cancelled. */
  | { readonly kind: "cancelled"; readonly proposal: ProposalOf<CancellationTerms>; readonly intent: BookingChangeIntent }
  /** The booking now sits at the new slot. */
  | { readonly kind: "rescheduled"; readonly proposal: ProposalOf<RescheduleTerms>; readonly intent: BookingChangeIntent }
  /**
   * The provider couldn't take the new slot. Nothing moved; these are its other free slots that
   * day, and the closest one is on a fresh card that needs its own tap.
   */
  | {
      readonly kind: "reschedule_conflict";
      readonly proposal: ProposalOf<RescheduleTerms>;
      readonly alternatives: readonly Slot[];
      readonly freshProposal?: ProposalOf<RescheduleTerms>;
      readonly intent: BookingChangeIntent;
    }
  /** The change didn't happen: the provider kept failing (`service_unavailable`), the booking is gone, … */
  | { readonly kind: "change_failed"; readonly proposal: BookingChangeProposal; readonly reason: string; readonly intent: BookingChangeIntent }
  /** Another writer is still carrying it out; the ledger settles it. */
  | { readonly kind: "change_verifying"; readonly proposal: BookingChangeProposal; readonly intent: BookingChangeIntent };

export type ExecuteBookingChangeOutcome =
  | BookingChangeOutcome
  /** Carried out earlier; nothing new was done. */
  | { readonly kind: "already_changed"; readonly proposal: BookingChangeProposal }
  | { readonly kind: "not_approved"; readonly proposal: BookingChangeProposal }
  | { readonly kind: "declined"; readonly proposal: BookingChangeProposal }
  | { readonly kind: "approval_expired"; readonly proposal: BookingChangeProposal }
  | { readonly kind: "fingerprint_mismatch"; readonly proposal: BookingChangeProposal }
  /** The booking or the fee changed after the approval. Nothing changed; a fresh card shows the live terms. */
  | {
      readonly kind: "approval_invalidated";
      readonly proposal: BookingChangeProposal;
      readonly changes: readonly TermChange[];
      readonly freshProposal: BookingChangeProposal;
    }
  /** The booking was completed, cancelled (by the provider, or before) or started since the card. Nothing changed. */
  | { readonly kind: "booking_unavailable"; readonly proposal: BookingChangeProposal; readonly cancelledByProvider: boolean };

function isCancellation(proposal: BookingChangeProposal): proposal is ProposalOf<CancellationTerms> {
  return proposal.terms.action === "cancel";
}

function isReschedule(proposal: BookingChangeProposal): proposal is ProposalOf<RescheduleTerms> {
  return proposal.terms.action === "reschedule";
}

async function saved<P extends BookingChangeProposal>(deps: BookingDependencies, proposal: P): Promise<P> {
  await deps.proposals.saveProposal(proposal);
  return proposal;
}

/** The provider couldn't take the new slot: its other free slots that day, the closest on a fresh card. */
async function conflicted(
  deps: BookingDependencies,
  proposal: ProposalOf<RescheduleTerms>,
  intent: BookingChangeIntent,
): Promise<BookingChangeOutcome> {
  const failed = await saved(deps, { ...proposal, status: "failed" });
  const { terms } = proposal;
  const nowMs = deps.worldClock.now().getTime();
  const booking = await bookingOf(deps.world, proposal.userId, terms.bookingId);
  const provider = await deps.world.getProvider(terms.providerId);
  if (booking === undefined || !isChangeable(booking, nowMs) || provider.kind !== "found") {
    return { kind: "reschedule_conflict", proposal: failed, alternatives: [], intent };
  }
  const alternatives = await alternativesTo(deps.world, provider.provider, terms.slot);
  const [closest] = alternatives;
  if (closest === undefined) return { kind: "reschedule_conflict", proposal: failed, alternatives, intent };
  const who = { proposalId: deps.ids.next("prp"), sessionId: proposal.sessionId, userId: proposal.userId };
  const fresh = await saved(deps, proposeTerms(rescheduleTermsOf(booking, provider.provider, closest, nowMs), who, deps.hasher, nowMs));
  return { kind: "reschedule_conflict", proposal: failed, alternatives, freshProposal: fresh, intent };
}

/** What a settled (or still unsettled) change intent means for its proposal and the person. */
export async function settledBookingChange(
  deps: BookingDependencies,
  request: { readonly proposal: BookingChangeProposal; readonly intent: BookingChangeIntent },
): Promise<BookingChangeOutcome> {
  const { proposal, intent } = request;
  switch (intent.state) {
    case "confirmed": {
      const executed = await saved(deps, { ...proposal, status: "executed" });
      if (isCancellation(executed)) return { kind: "cancelled", proposal: executed, intent };
      if (isReschedule(executed)) return { kind: "rescheduled", proposal: executed, intent };
      throw new Error(`Proposal ${proposal.proposalId} is neither a cancellation nor a reschedule.`);
    }
    case "failed": {
      if (intent.failureReason === "slot_conflict" && isReschedule(proposal)) return conflicted(deps, proposal, intent);
      const failed = await saved(deps, { ...proposal, status: "failed" });
      return { kind: "change_failed", proposal: failed, reason: intent.failureReason ?? "unknown", intent };
    }
    case "pending":
    case "unknown":
      return { kind: "change_verifying", proposal: await saved(deps, { ...proposal, status: "verifying" }), intent };
  }
}

/** The terms as the world has them now: the live booking, its provider, and the fee at this moment. */
async function liveTerms(deps: BookingDependencies, proposal: BookingChangeProposal): Promise<BookingChangeTerms | undefined> {
  const nowMs = deps.worldClock.now().getTime();
  const booking = await bookingOf(deps.world, proposal.userId, proposal.terms.bookingId);
  if (booking === undefined || !isChangeable(booking, nowMs)) return undefined;
  const provider = await deps.world.getProvider(booking.providerId);
  if (provider.kind !== "found") return undefined;
  const { terms } = proposal;
  return terms.action === "cancel"
    ? cancellationTermsOf(booking, provider.provider, nowMs)
    : rescheduleTermsOf(booking, provider.provider, terms.slot, nowMs);
}

/**
 * Runs before the grant is used. Undefined when the live booking still carries exactly the
 * approved terms; otherwise the grant is voided and nothing changes. A fee that went up because
 * the free window closed is a changed term like any other: the person approves it afresh.
 */
async function revalidated(
  deps: BookingDependencies,
  proposal: BookingChangeProposal,
  grant: Grant,
): Promise<ExecuteBookingChangeOutcome | undefined> {
  const live = await liveTerms(deps, proposal);
  if (live !== undefined && fingerprintOf(live, deps.hasher) === grant.fingerprint) return undefined;
  const nowMs = deps.worldClock.now().getTime();
  await deps.proposals.voidGrant(grant.grantId, nowMs);
  if (live === undefined) {
    const booking = await bookingOf(deps.world, proposal.userId, proposal.terms.bookingId);
    const cancelledByProvider = booking !== undefined && isCancelledByProvider(booking);
    return { kind: "booking_unavailable", proposal: await saved(deps, { ...proposal, status: "voided" }), cancelledByProvider };
  }
  const who = { proposalId: deps.ids.next("prp"), sessionId: proposal.sessionId, userId: proposal.userId };
  const fresh = proposeChange(live, who, deps.hasher, nowMs);
  const changes = termChangesBetween(proposal.terms, fresh.terms);
  const voided = await saved(deps, { ...proposal, status: "voided", invalidation: { changes, replacedBy: fresh.proposalId, atMs: nowMs } });
  // Saved after the voided one, so the fresh card is the session's latest.
  await deps.proposals.saveProposal(fresh);
  return { kind: "approval_invalidated", proposal: voided, changes, freshProposal: fresh };
}

/** Records the intent, uses the grant and sends the change; the outcome comes from the booking's status. */
async function changeWithGrant(
  deps: BookingDependencies,
  proposal: BookingChangeProposal,
  grant: Grant,
  place: TracePlace,
): Promise<BookingChangeOutcome> {
  const fresh = bookingChangeIntentFor(proposal, grant, deps.errand.clock.now().getTime());
  const intent = await deps.ledger.record(fresh);
  if (intent.version === fresh.version && intent.createdAtMs === fresh.createdAtMs) {
    await deps.errand.traceSink.record(ledgerEvent(undefined, intent, place));
  }
  if (!(await deps.proposals.consumeGrant(grant.grantId, deps.worldClock.now().getTime()))) {
    // Another execution used the grant first and is carrying out this same intent.
    const stored = await deps.ledger.find(intent.idempotencyKey);
    return { kind: "change_verifying", proposal, intent: stored !== undefined && stored.action !== "book" ? stored : intent };
  }
  const executing = await saved(deps, { ...proposal, status: "executing" });
  const settled = await settleBookingChange(ledgerDependenciesOf(deps), { intent, place, by: "execution" });
  return settledBookingChange(deps, { proposal: executing, intent: settled });
}

/**
 * The grant was used before this execution got to it (an execution that was cut off, or crashed).
 * The ledger settles it with the same key, so asking again never cancels or moves twice.
 */
async function changeOfUsedGrant(
  deps: BookingDependencies,
  proposal: BookingChangeProposal,
  grant: Grant,
  place: TracePlace,
): Promise<BookingChangeOutcome> {
  // A call may have been sent, so it counts as one attempt and the status is read first.
  const unknown: BookingChangeIntent = { ...bookingChangeIntentFor(proposal, grant, deps.errand.clock.now().getTime()), attempts: 1 };
  const intent = await deps.ledger.record(unknown);
  const settled = isResolved(intent) ? intent : await settleBookingChange(ledgerDependenciesOf(deps), { intent, place, by: "execution" });
  return settledBookingChange(deps, { proposal, intent: settled });
}

/** Carries out the session's cancel or reschedule card, if and only if the person approved exactly it. */
export async function executeBookingChange(
  deps: BookingDependencies,
  request: { readonly proposal: BookingChangeProposal; readonly place: TracePlace },
): Promise<ExecuteBookingChangeOutcome> {
  const { proposal, place } = request;
  if (proposal.status === "executed") return { kind: "already_changed", proposal };
  if (proposal.status === "declined") return { kind: "declined", proposal };

  const grant = await deps.proposals.grantOf(proposal.proposalId);
  if (grant === undefined) return { kind: "not_approved", proposal };
  if (grant.fingerprint !== proposal.fingerprint || !matchesFingerprint(proposal.terms, grant.fingerprint, deps.hasher)) {
    return { kind: "fingerprint_mismatch", proposal };
  }
  if (isConsumed(grant)) return changeOfUsedGrant(deps, proposal, grant, place);

  if (proposal.status === "expired" || isGrantExpired(grant, deps.worldClock.now().getTime())) {
    return { kind: "approval_expired", proposal: await saved(deps, { ...proposal, status: "expired" }) };
  }
  return (await revalidated(deps, proposal, grant)) ?? changeWithGrant(deps, proposal, grant, place);
}
