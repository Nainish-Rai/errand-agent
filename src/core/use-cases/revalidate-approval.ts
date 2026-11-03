import { fingerprintOf } from "../approval/fingerprint";
import type { Grant } from "../approval/grant";
import { termChangesBetween, type TermChange } from "../approval/invalidation";
import { bookingTermsOf, proposeTerms, type Proposal } from "../approval/proposal";
import type { Errand } from "../errand/errand";
import type { Hold } from "../ports/provider-world";
import { moved, withoutHold, type ProposalDependencies } from "./proposal-session";

// The approval covered the terms the card showed, but a provider can change a held price or slot
// (or the hold can run out) between the click and the booking. So before the grant is used, core
// re-reads the live hold and recomputes the fingerprint from what the provider has now. Any
// difference voids the grant and books nothing; the live terms become a fresh proposal that needs
// its own click. An expired hold is held again and proposed again, never booked on the old approval.

export type ApprovalRevalidationOutcome =
  /** The provider changed the price, slot or provider after the approval. The grant is void; nothing was booked. */
  | {
      readonly kind: "approval_invalidated";
      readonly proposal: Proposal;
      readonly changes: readonly TermChange[];
      readonly freshProposal: Proposal;
    }
  /** The hold ran out before the booking. The slot was held again for a fresh proposal; nothing was booked. */
  | {
      readonly kind: "hold_reproposed";
      readonly proposal: Proposal;
      /** What the new hold quotes differently, if anything. */
      readonly changes: readonly TermChange[];
      readonly freshProposal: Proposal;
    }
  /** The hold ran out and the slot can't be held again. Nothing was booked; the errand is back to its options. */
  | { readonly kind: "hold_lost"; readonly proposal: Proposal };

export interface Revalidated {
  readonly outcome: ApprovalRevalidationOutcome;
  readonly errand: Errand;
}

function isLive(hold: Hold, nowMs: number): boolean {
  return nowMs <= Date.parse(hold.expiresAt);
}

/** The fingerprint of what the provider holds now: the approved action on the live provider, slot, price and hold. */
function liveFingerprint(proposal: Proposal, hold: Hold, deps: ProposalDependencies): string {
  return fingerprintOf(
    { action: proposal.terms.action, providerId: hold.providerId, slot: hold.slot, priceInr: hold.quotedPriceInr, holdId: hold.holdId },
    deps.hasher,
  );
}

/** A new pending proposal on the live hold, in the same session and for the same person. */
async function freshProposalOn(hold: Hold, proposal: Proposal, deps: ProposalDependencies): Promise<Proposal | undefined> {
  const provider = await deps.world.getProvider(hold.providerId);
  if (provider.kind !== "found") return undefined;
  const terms = bookingTermsOf(hold, provider.provider, proposal.terms.area);
  const who = { proposalId: deps.ids.next("prp"), sessionId: proposal.sessionId, userId: proposal.userId };
  return proposeTerms(terms, who, deps.hasher, deps.worldClock.now().getTime());
}

async function lost(errand: Errand, proposal: Proposal, deps: ProposalDependencies): Promise<Revalidated> {
  const expired: Proposal = { ...proposal, status: "expired" };
  await deps.proposals.saveProposal(expired);
  return { outcome: { kind: "hold_lost", proposal: expired }, errand: moved(withoutHold(errand), "choosing", "hold_lost", deps.errand.clock) };
}

/** Saves the replaced proposal with what changed, then the fresh one, so the fresh one is the session's latest. */
async function replaced(
  proposal: Proposal,
  status: "voided" | "expired",
  fresh: Proposal,
  deps: ProposalDependencies,
): Promise<{ readonly old: Proposal; readonly changes: readonly TermChange[] }> {
  const changes = termChangesBetween(proposal.terms, fresh.terms);
  const old: Proposal = {
    ...proposal,
    status,
    invalidation: { changes, replacedBy: fresh.proposalId, atMs: deps.worldClock.now().getTime() },
  };
  await deps.proposals.saveProposal(old);
  await deps.proposals.saveProposal(fresh);
  return { old, changes };
}

/** The errand holds `hold` again and waits for the fresh proposal's approval. */
function awaitingFreshApproval(errand: Errand, hold: Hold, reason: "proposal_voided" | "slot_held", deps: ProposalDependencies): Errand {
  const { clock } = deps.errand;
  const holding = moved(withoutHold(errand), "holding", reason, clock);
  return moved({ ...holding, hold }, "awaiting_approval", "proposal_shown", clock);
}

async function invalidated(errand: Errand, proposal: Proposal, hold: Hold, deps: ProposalDependencies): Promise<Revalidated> {
  const fresh = await freshProposalOn(hold, proposal, deps);
  if (fresh === undefined) return lost(errand, proposal, deps);
  const { old, changes } = await replaced(proposal, "voided", fresh, deps);
  return {
    outcome: { kind: "approval_invalidated", proposal: old, changes, freshProposal: fresh },
    errand: awaitingFreshApproval(errand, hold, "proposal_voided", deps),
  };
}

/**
 * The hold behind an approved proposal ran out (by the live hold, or because `book` said so):
 * hold the same slot again and propose it again. Nothing is booked until the fresh proposal is
 * approved. If the slot can't be held again, the errand goes back to its options.
 */
export async function reproposeExpiredHold(errand: Errand, proposal: Proposal, deps: ProposalDependencies): Promise<Revalidated> {
  const held = await deps.world.holdSlot(proposal.terms.providerId, proposal.terms.slot);
  if (held.kind !== "held") return lost(errand, proposal, deps);
  const fresh = await freshProposalOn(held.hold, proposal, deps);
  if (fresh === undefined) {
    await deps.world.releaseHold(held.hold.holdId);
    return lost(errand, proposal, deps);
  }
  const { old, changes } = await replaced(proposal, "expired", fresh, deps);
  return {
    outcome: { kind: "hold_reproposed", proposal: old, changes, freshProposal: fresh },
    errand: awaitingFreshApproval(errand, held.hold, "slot_held", deps),
  };
}

/**
 * Runs before the grant is used. Undefined when the live hold still carries exactly the approved
 * terms, so the booking may go ahead; otherwise the grant is voided and what happened instead.
 */
export async function revalidateApproval(
  errand: Errand,
  proposal: Proposal,
  grant: Grant,
  deps: ProposalDependencies,
): Promise<Revalidated | undefined> {
  const live = await deps.world.getHold(proposal.terms.holdId);
  const nowMs = deps.worldClock.now().getTime();
  if (live.kind === "held" && isLive(live.hold, nowMs) && liveFingerprint(proposal, live.hold, deps) === grant.fingerprint) {
    return undefined;
  }
  // Void first: whatever happens next, this grant can never book anything.
  await deps.proposals.voidGrant(grant.grantId, nowMs);
  if (live.kind === "held" && isLive(live.hold, nowMs)) return invalidated(errand, proposal, live.hold, deps);
  return reproposeExpiredHold(errand, proposal, deps);
}
