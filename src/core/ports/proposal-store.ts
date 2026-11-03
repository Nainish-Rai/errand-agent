import type { Grant } from "../approval/grant";
import type { Proposal, ProposalStatus } from "../approval/proposal";

export interface ProposalQuery {
  readonly userId: string;
  /** Only proposals in this status; absent means every status. */
  readonly status?: ProposalStatus;
  /** Only proposals made in this chat session. */
  readonly sessionId?: string;
}

/**
 * Proposals and the grants minted for them. Must survive a restart. Every method that decides
 * something (one grant per proposal, a grant used once) decides it atomically in the store, so two
 * clicks or two executions racing each other can't both win.
 */
export interface ProposalStore {
  /** Inserts the proposal, or replaces the stored one with the same id. */
  saveProposal(proposal: Proposal): Promise<void>;
  findProposal(proposalId: string): Promise<Proposal | undefined>;
  /** The session's most recent proposal, whatever its status. */
  latestProposalOf(sessionId: string): Promise<Proposal | undefined>;
  /** The proposal whose execution made this booking. */
  findProposalByBooking(bookingId: string): Promise<Proposal | undefined>;
  /** Newest first. */
  listProposals(query: ProposalQuery): Promise<readonly Proposal[]>;
  /**
   * Stores `grant` unless its proposal already has one, and returns the proposal's one grant:
   * `grant` itself, or the one an earlier approval stored. A proposal never has two grants.
   */
  issueGrant(grant: Grant): Promise<Grant>;
  grantOf(proposalId: string): Promise<Grant | undefined>;
  /** Marks the grant used. True for exactly one caller; false when it was already used or doesn't exist. */
  consumeGrant(grantId: string, atMs: number): Promise<boolean>;
  /** Dev only: the world was reseeded, so every stored proposal names holds that no longer exist. */
  discardAll(): Promise<void>;
}
