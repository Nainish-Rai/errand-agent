import type { Grant } from "../approval/grant";
import { currentStatus, type Proposal } from "../approval/proposal";
import type { Clock } from "../ports/clock";
import type { ProposalQuery, ProposalStore } from "../ports/proposal-store";

// Queries over proposals for the approval card and the "Waiting on you" list. Each proposal comes
// with its grant, if one was minted, and its status as of now on the world's clock.

export interface ProposalStanding {
  readonly proposal: Proposal;
  readonly grant?: Grant;
  /** Milliseconds left on the hold, 0 once it has run out. */
  readonly holdLeftMs: number;
}

type ProposalReader = { readonly proposals: ProposalStore; readonly worldClock: Clock };

async function standingOf(proposal: Proposal, deps: ProposalReader): Promise<ProposalStanding> {
  const nowMs = deps.worldClock.now().getTime();
  const grant = await deps.proposals.grantOf(proposal.proposalId);
  return {
    proposal: { ...proposal, status: currentStatus(proposal, nowMs) },
    ...(grant === undefined ? {} : { grant }),
    holdLeftMs: Math.max(0, Date.parse(proposal.terms.holdExpiresAt) - nowMs),
  };
}

/** One of the person's proposals, or undefined when there is none with that id for them. */
export async function getProposal(
  deps: ProposalReader,
  request: { readonly proposalId: string; readonly userId: string },
): Promise<ProposalStanding | undefined> {
  const proposal = await deps.proposals.findProposal(request.proposalId);
  if (proposal === undefined || proposal.userId !== request.userId) return undefined;
  return standingOf(proposal, deps);
}

/** The person's proposals, newest first, filtered by status as it stands now. */
export async function listProposals(deps: ProposalReader, query: ProposalQuery): Promise<readonly ProposalStanding[]> {
  const { status, ...rest } = query;
  const stored = await deps.proposals.listProposals(rest);
  const standings = await Promise.all(stored.map((proposal) => standingOf(proposal, deps)));
  return status === undefined ? standings : standings.filter((standing) => standing.proposal.status === status);
}
