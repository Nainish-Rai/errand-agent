import { grantFor, type Grant, type UserApproval } from "../approval/grant";
import { isHoldExpired, type Proposal, type ProposalStatus } from "../approval/proposal";
import type { ProposalDependencies } from "./proposal-session";

// ApproveProposal: the person clicked Approve on the card. This is the only code that mints a
// grant, and its only caller is the app API's approve route, which takes the person from the
// channel's auth context. No agent tool can reach it (dependency-cruiser enforces that).
//
// Idempotent: a second click (or a retried request) gets the same grant back, never a second one.

export type ApproveProposalOutcome =
  | { readonly kind: "approved"; readonly proposal: Proposal; readonly grant: Grant }
  /** No such proposal for this person. Someone else's proposal reads the same, so ids can't be probed. */
  | { readonly kind: "proposal_not_found" }
  /** The card's fingerprint isn't the proposal's: the terms changed, or the click was forged. */
  | { readonly kind: "fingerprint_mismatch"; readonly proposal: Proposal }
  /** Declined, expired or already carried out without this approval. */
  | { readonly kind: "not_pending"; readonly proposal: Proposal; readonly status: ProposalStatus }
  | { readonly kind: "hold_expired"; readonly proposal: Proposal };

type ApproveDependencies = Pick<ProposalDependencies, "proposals" | "ids" | "worldClock">;

export async function approveProposal(deps: ApproveDependencies, approval: UserApproval): Promise<ApproveProposalOutcome> {
  const proposal = await deps.proposals.findProposal(approval.proposalId);
  if (proposal === undefined || proposal.userId !== approval.userId) return { kind: "proposal_not_found" };
  if (approval.fingerprint !== proposal.fingerprint) return { kind: "fingerprint_mismatch", proposal };

  if (proposal.status === "declined" || proposal.status === "expired") {
    return { kind: "not_pending", proposal, status: proposal.status };
  }
  const existing = await deps.proposals.grantOf(proposal.proposalId);
  if (existing !== undefined) return { kind: "approved", proposal, grant: existing };
  if (proposal.status !== "pending") return { kind: "not_pending", proposal, status: proposal.status };

  const nowMs = deps.worldClock.now().getTime();
  if (isHoldExpired(proposal, nowMs)) {
    const expired: Proposal = { ...proposal, status: "expired" };
    await deps.proposals.saveProposal(expired);
    return { kind: "hold_expired", proposal: expired };
  }

  const grant = await deps.proposals.issueGrant(grantFor(proposal, approval, deps.ids.next("grt"), nowMs));
  const approved: Proposal = { ...proposal, status: "approved" };
  await deps.proposals.saveProposal(approved);
  return { kind: "approved", proposal: approved, grant };
}
