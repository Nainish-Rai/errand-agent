import { isConsumed } from "../approval/grant";
import { isExecutionStarted, type Proposal, type ProposalStatus } from "../approval/proposal";
import type { Errand } from "../errand/errand";
import { traceNewTransitions } from "./errand-session";
import { moved, sessionPlace, withoutHold, type ProposalDependencies } from "./proposal-session";

// DeclineProposal: the person clicked Decline (or Other options) on the card. Nothing is booked,
// the held slot goes back to the provider, and the errand returns to its options. Declining twice
// is the same as declining once.

export type DeclineProposalOutcome =
  | { readonly kind: "declined"; readonly proposal: Proposal }
  | { readonly kind: "proposal_not_found" }
  /** The booking was already under way; declining can't undo it. */
  | { readonly kind: "too_late"; readonly proposal: Proposal; readonly status: ProposalStatus };

function backToOptions(errand: Errand | undefined, proposal: Proposal, deps: ProposalDependencies): Errand | undefined {
  if (errand === undefined || errand.hold?.holdId !== proposal.terms.holdId) return undefined;
  if (errand.state !== "awaiting_approval" && errand.state !== "holding") return undefined;
  return moved(withoutHold(errand), "choosing", "proposal_declined", deps.errand.clock);
}

async function declined(
  current: Errand | undefined,
  proposal: Proposal,
  deps: ProposalDependencies,
): Promise<{ readonly outcome: DeclineProposalOutcome; readonly errand?: Errand }> {
  if (proposal.status === "declined") return { outcome: { kind: "declined", proposal } };
  const grant = await deps.proposals.grantOf(proposal.proposalId);
  if (isExecutionStarted(proposal) || (grant !== undefined && isConsumed(grant))) {
    return { outcome: { kind: "too_late", proposal, status: proposal.status } };
  }
  const declinedProposal: Proposal = { ...proposal, status: "declined" };
  await deps.proposals.saveProposal(declinedProposal);
  await deps.world.releaseHold(proposal.terms.holdId);
  return { outcome: { kind: "declined", proposal: declinedProposal }, errand: backToOptions(current, proposal, deps) };
}

export async function declineProposal(
  deps: ProposalDependencies,
  request: { readonly proposalId: string; readonly userId: string },
): Promise<DeclineProposalOutcome> {
  const found = await deps.proposals.findProposal(request.proposalId);
  if (found === undefined || found.userId !== request.userId) return { kind: "proposal_not_found" };
  // Inside the session's queue of errand changes, so a decline and an execution of the same
  // proposal run one after the other: whichever comes second sees what the first did.
  return deps.errand.errands.change(found.sessionId, async (current) => {
    const proposal = (await deps.proposals.findProposal(found.proposalId)) ?? found;
    const { outcome, errand } = await declined(current, proposal, deps);
    if (errand === undefined) return { result: outcome };
    await traceNewTransitions(deps.errand.traceSink, current, errand, sessionPlace(proposal.sessionId));
    return { errand, result: outcome };
  });
}
