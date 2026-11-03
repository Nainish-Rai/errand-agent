import { matchesFingerprint } from "../approval/fingerprint";
import { isConsumed, isGrantExpired } from "../approval/grant";
import { isBookingChangeProposal, type BookingProposal } from "../approval/proposal";
import type { Errand } from "../errand/errand";
import type { TracePlace } from "../errand/errand-workflow";
import { bookApprovedProposal, bookingOfUsedGrant, type BookingDependencies, type BookingOutcome } from "./book-approved-proposal";
import { executeBookingChange, type ExecuteBookingChangeOutcome } from "./change-approved-booking";
import { traceNewTransitions } from "./errand-session";
import { moved, withoutHold } from "./proposal-session";
import { revalidateApproval, type ApprovalRevalidationOutcome } from "./revalidate-approval";

// ExecuteProposal: carry out the session's proposal, if and only if the person approved it on the
// card. The agent calls this after the person says to go ahead, however they say it; the check is
// here, in code. With no grant it books nothing and hands the card back to be shown again.
//
// With a grant: the live hold is re-read first, and any change to the approved terms voids the grant
// (revalidate-approval). Then the action ledger records the intent, the grant is used (once,
// atomically), `book` is called with a key derived from it, and the result is checked with
// `get_booking_status` before anything is reported as booked (see book-approved-proposal.ts).
// Asking again, however often, never books twice: a used grant is answered from the ledger, and an
// unsettled intent is settled with the same key.
//
// When the card is a cancellation or a reschedule, the same rules run on the booking it changes
// (change-approved-booking.ts); the errand, which is about booking something new, isn't touched.

export type ExecuteProposalOutcome =
  /**
   * Booked, and the world's status confirms this booking ID (`booked`); `slot_taken` with the next
   * options; `verifying` while the world can't say yet; `booking_failed`.
   */
  | BookingOutcome
  /** Carried out earlier; nothing new was done. */
  | { readonly kind: "already_booked"; readonly proposal: BookingProposal; readonly bookingId: string }
  /** Nobody clicked Approve. Nothing was booked; the card is shown again. */
  | { readonly kind: "not_approved"; readonly proposal: BookingProposal }
  | { readonly kind: "no_proposal" }
  | { readonly kind: "declined"; readonly proposal: BookingProposal }
  /** The grant or the hold ran out first. Nothing was booked. */
  | { readonly kind: "approval_expired"; readonly proposal: BookingProposal }
  /** The grant doesn't cover this proposal's terms. Nothing was booked. */
  | { readonly kind: "fingerprint_mismatch"; readonly proposal: BookingProposal }
  /** The errand is no longer waiting on this approval: it moved on, or a restart lost it. */
  | { readonly kind: "out_of_step"; readonly proposal: BookingProposal }
  /** The card was a cancellation or a reschedule: what became of it. */
  | ExecuteBookingChangeOutcome
  /** The live hold no longer matched the approval, or ran out. Nothing was booked; a fresh proposal may be on the card. */
  | ApprovalRevalidationOutcome;

interface Executed {
  readonly outcome: ExecuteProposalOutcome;
  readonly errand?: Errand;
}

async function executed(errand: Errand | undefined, deps: BookingDependencies, place: TracePlace): Promise<Executed> {
  const { sessionId } = place;
  const proposal = await deps.proposals.latestProposalOf(sessionId);
  if (proposal === undefined) return { outcome: { kind: "no_proposal" } };
  if (isBookingChangeProposal(proposal)) return { outcome: await executeBookingChange(deps, { proposal, place }) };
  if (proposal.status === "executed" && proposal.bookingId !== undefined) {
    return { outcome: { kind: "already_booked", proposal, bookingId: proposal.bookingId } };
  }
  if (proposal.status === "declined") return { outcome: { kind: "declined", proposal } };

  const grant = await deps.proposals.grantOf(proposal.proposalId);
  if (grant === undefined) return { outcome: { kind: "not_approved", proposal } };
  if (grant.fingerprint !== proposal.fingerprint || !matchesFingerprint(proposal.terms, grant.fingerprint, deps.hasher)) {
    return { outcome: { kind: "fingerprint_mismatch", proposal } };
  }
  if (isConsumed(grant)) return bookingOfUsedGrant(deps, { errand, proposal, grant, place });
  if (errand?.state !== "awaiting_approval") return { outcome: { kind: "out_of_step", proposal } };

  const nowMs = deps.worldClock.now().getTime();
  if (proposal.status === "expired" || isGrantExpired(grant, nowMs)) {
    const expired: BookingProposal = { ...proposal, status: "expired" };
    await deps.proposals.saveProposal(expired);
    return {
      outcome: { kind: "approval_expired", proposal: expired },
      errand: moved(withoutHold(errand), "choosing", "hold_lost", deps.errand.clock),
    };
  }
  const revalidated = await revalidateApproval(errand, proposal, grant, deps);
  if (revalidated !== undefined) return revalidated;
  return bookApprovedProposal(deps, { errand, proposal, grant, place });
}

export function executeProposal(deps: BookingDependencies, request: { readonly place: TracePlace }): Promise<ExecuteProposalOutcome> {
  return deps.errand.errands.change(request.place.sessionId, async (current) => {
    const { outcome, errand } = await executed(current, deps, request.place);
    if (errand === undefined) return { result: outcome };
    await traceNewTransitions(deps.errand.traceSink, current, errand, request.place);
    return { errand, result: outcome };
  });
}
