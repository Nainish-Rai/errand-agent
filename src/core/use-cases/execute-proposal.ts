import { matchesFingerprint } from "../approval/fingerprint";
import { idempotencyKeyOf, isConsumed, isGrantExpired, type Grant } from "../approval/grant";
import type { Proposal } from "../approval/proposal";
import { verifyBooking, needsStatusCheck, type BookingVerification } from "../booking/booking-verification";
import type { Errand } from "../errand/errand";
import type { TracePlace } from "../errand/errand-workflow";
import { traceNewTransitions } from "./errand-session";
import { moved, withoutHold, type ProposalDependencies } from "./proposal-session";
import { reproposeExpiredHold, revalidateApproval, type ApprovalRevalidationOutcome } from "./revalidate-approval";

// ExecuteProposal: carry out the session's proposal, if and only if the person approved it on the
// card. The agent calls this after the person says to go ahead, however they say it; the check is
// here, in code. With no grant it books nothing and hands the card back to be shown again.
//
// With a grant: the live hold is re-read first, and any change to the approved terms voids the grant
// (revalidate-approval). Then the grant is used (once, atomically), `book` is called with a key
// derived from it, and the result is checked with `get_booking_status` before anything is reported
// as booked.

export type ExecuteProposalOutcome =
  /** Booked, and the world's status confirms this booking ID. */
  | { readonly kind: "booked"; readonly proposal: Proposal; readonly bookingId: string }
  /** Carried out earlier; nothing new was done. */
  | { readonly kind: "already_booked"; readonly proposal: Proposal; readonly bookingId: string }
  /** Nobody clicked Approve. Nothing was booked; the card is shown again. */
  | { readonly kind: "not_approved"; readonly proposal: Proposal }
  | { readonly kind: "no_proposal" }
  | { readonly kind: "declined"; readonly proposal: Proposal }
  /** The grant or the hold ran out first. Nothing was booked. */
  | { readonly kind: "approval_expired"; readonly proposal: Proposal }
  /** The grant doesn't cover this proposal's terms. Nothing was booked. */
  | { readonly kind: "fingerprint_mismatch"; readonly proposal: Proposal }
  /** The grant was already used by another execution, whose result isn't in yet. */
  | { readonly kind: "grant_used"; readonly proposal: Proposal }
  /** The errand is no longer waiting on this approval: it moved on, or a restart lost it. */
  | { readonly kind: "out_of_step"; readonly proposal: Proposal }
  | { readonly kind: "slot_taken"; readonly proposal: Proposal }
  /** `book` timed out and the status can't confirm either way yet. Not booked, not failed. */
  | { readonly kind: "verifying"; readonly proposal: Proposal }
  | { readonly kind: "booking_failed"; readonly proposal: Proposal; readonly reason: string }
  /** The live hold no longer matched the approval, or ran out. Nothing was booked; a fresh proposal may be on the card. */
  | ApprovalRevalidationOutcome;

interface Executed {
  readonly outcome: ExecuteProposalOutcome;
  readonly errand?: Errand;
}

async function verifiedBooking(proposal: Proposal, grant: Grant, deps: ProposalDependencies): Promise<BookingVerification> {
  const key = idempotencyKeyOf(grant);
  const booked = await deps.world.book(proposal.terms.holdId, key);
  // Never trust book's own reply: a timeout may hide a booking, so the status decides.
  const status = needsStatusCheck(booked) ? await deps.world.getBookingStatus(key) : undefined;
  return verifyBooking(booked, status);
}

async function settled(
  errand: Errand,
  proposal: Proposal,
  verification: BookingVerification,
  deps: ProposalDependencies,
): Promise<Executed> {
  const { clock } = deps.errand;
  if (verification.kind === "failed" && verification.reason === "hold_expired") return reproposeExpiredHold(errand, proposal, deps);
  switch (verification.kind) {
    case "verified": {
      const executed: Proposal = { ...proposal, status: "executed", bookingId: verification.bookingId };
      await deps.proposals.saveProposal(executed);
      return {
        outcome: { kind: "booked", proposal: executed, bookingId: verification.bookingId },
        errand: moved(withoutHold(errand), "done", "booking_verified", clock),
      };
    }
    case "unverified": {
      const verifying: Proposal = { ...proposal, status: "verifying" };
      await deps.proposals.saveProposal(verifying);
      return { outcome: { kind: "verifying", proposal: verifying }, errand: moved(errand, "verifying", "awaiting_verification", clock) };
    }
    case "slot_taken":
    case "failed": {
      const failed: Proposal = { ...proposal, status: "failed" };
      await deps.proposals.saveProposal(failed);
      const outcome: ExecuteProposalOutcome =
        verification.kind === "slot_taken"
          ? { kind: "slot_taken", proposal: failed }
          : { kind: "booking_failed", proposal: failed, reason: verification.reason };
      return { outcome, errand: moved(withoutHold(errand), "failed", "booking_failed", clock) };
    }
  }
}

async function executed(errand: Errand | undefined, deps: ProposalDependencies, sessionId: string): Promise<Executed> {
  const proposal = await deps.proposals.latestProposalOf(sessionId);
  if (proposal === undefined) return { outcome: { kind: "no_proposal" } };
  if (proposal.status === "executed" && proposal.bookingId !== undefined) {
    return { outcome: { kind: "already_booked", proposal, bookingId: proposal.bookingId } };
  }
  if (proposal.status === "declined") return { outcome: { kind: "declined", proposal } };

  const grant = await deps.proposals.grantOf(proposal.proposalId);
  if (grant === undefined) return { outcome: { kind: "not_approved", proposal } };
  if (grant.fingerprint !== proposal.fingerprint || !matchesFingerprint(proposal.terms, grant.fingerprint, deps.hasher)) {
    return { outcome: { kind: "fingerprint_mismatch", proposal } };
  }
  if (isConsumed(grant)) return { outcome: { kind: "grant_used", proposal } };
  if (errand?.state !== "awaiting_approval") return { outcome: { kind: "out_of_step", proposal } };

  const nowMs = deps.worldClock.now().getTime();
  if (proposal.status === "expired" || isGrantExpired(grant, nowMs)) {
    const expired: Proposal = { ...proposal, status: "expired" };
    await deps.proposals.saveProposal(expired);
    return {
      outcome: { kind: "approval_expired", proposal: expired },
      errand: moved(withoutHold(errand), "choosing", "hold_lost", deps.errand.clock),
    };
  }
  const revalidated = await revalidateApproval(errand, proposal, grant, deps);
  if (revalidated !== undefined) return revalidated;
  if (!(await deps.proposals.consumeGrant(grant.grantId, nowMs))) return { outcome: { kind: "grant_used", proposal } };

  const executing: Proposal = { ...proposal, status: "executing" };
  await deps.proposals.saveProposal(executing);
  const started = moved(errand, "executing", "approved", deps.errand.clock);
  return settled(started, executing, await verifiedBooking(executing, grant, deps), deps);
}

export function executeProposal(deps: ProposalDependencies, request: { readonly place: TracePlace }): Promise<ExecuteProposalOutcome> {
  return deps.errand.errands.change(request.place.sessionId, async (current) => {
    const { outcome, errand } = await executed(current, deps, request.place.sessionId);
    if (errand === undefined) return { result: outcome };
    await traceNewTransitions(deps.errand.traceSink, current, errand, request.place);
    return { errand, result: outcome };
  });
}
