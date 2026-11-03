import { bookingTermsOf, isAwaitingApproval, isBookingProposal, proposeTerms, type BookingProposal } from "../approval/proposal";
import type { Errand } from "../errand/errand";
import type { TracePlace } from "../errand/errand-workflow";
import { traceNewTransitions } from "./errand-session";
import { moved, withoutHold, type ProposalDependencies } from "./proposal-session";

// Turns the errand's live hold into a proposal for the approval card. It takes no terms from the
// model: the slot, price and hold come from the world's hold, and the provider's name and
// cancellation terms from the world's own record. Asking again while the card is up shows the
// same proposal again rather than making a second one.

export type ProposeBookingOutcome =
  | { readonly kind: "proposed"; readonly proposal: BookingProposal }
  /** Nothing is held, so there is nothing to propose. */
  | { readonly kind: "no_hold" }
  /** The hold ran out before the card was shown; the errand is back to choosing. */
  | { readonly kind: "hold_expired" }
  | { readonly kind: "provider_not_found" };

interface Proposed {
  readonly outcome: ProposeBookingOutcome;
  readonly errand?: Errand;
}

async function proposalShownAgain(errand: Errand, deps: ProposalDependencies): Promise<BookingProposal | undefined> {
  if (errand.state !== "awaiting_approval") return undefined;
  const latest = await deps.proposals.latestProposalOf(errand.sessionId);
  const nowMs = deps.worldClock.now().getTime();
  if (latest === undefined || !isBookingProposal(latest)) return undefined;
  return latest.terms.holdId === errand.hold?.holdId && isAwaitingApproval(latest, nowMs) ? latest : undefined;
}

async function proposed(errand: Errand, userId: string, deps: ProposalDependencies): Promise<Proposed> {
  const again = await proposalShownAgain(errand, deps);
  if (again !== undefined) return { outcome: { kind: "proposed", proposal: again } };

  const { hold } = errand;
  if (errand.state !== "holding" || hold === undefined) return { outcome: { kind: "no_hold" } };
  const nowMs = deps.worldClock.now().getTime();
  if (nowMs > Date.parse(hold.expiresAt)) {
    return { outcome: { kind: "hold_expired" }, errand: moved(withoutHold(errand), "choosing", "hold_lost", deps.errand.clock) };
  }
  const provider = await deps.world.getProvider(hold.providerId);
  if (provider.kind !== "found") return { outcome: { kind: "provider_not_found" } };

  const terms = bookingTermsOf(hold, provider.provider, errand.details.area ?? provider.provider.area);
  const proposal = proposeTerms(
    terms,
    { proposalId: deps.ids.next("prp"), sessionId: errand.sessionId, userId },
    deps.hasher,
    nowMs,
  );
  await deps.proposals.saveProposal(proposal);
  return { outcome: { kind: "proposed", proposal }, errand: moved(errand, "awaiting_approval", "proposal_shown", deps.errand.clock) };
}

export function proposeBooking(
  deps: ProposalDependencies,
  request: { readonly place: TracePlace; readonly userId: string },
): Promise<ProposeBookingOutcome> {
  return deps.errand.errands.change(request.place.sessionId, async (current) => {
    if (current === undefined) return { result: { kind: "no_hold" } };
    const { outcome, errand } = await proposed(current, request.userId, deps);
    if (errand === undefined) return { result: outcome };
    await traceNewTransitions(deps.errand.traceSink, current, errand, request.place);
    return { errand, result: outcome };
  });
}
