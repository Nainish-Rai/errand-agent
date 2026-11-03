import type { ProposedAction } from "./fingerprint";
import { approvalDeadlineOf, type Proposal } from "./proposal";

// A grant is the person's permission to carry out one proposal, exactly as fingerprinted. It is
// minted only from a click on the approval card (the app API's approve route is the one caller of
// ApproveProposal), used at most once, and never outlives the hold it would book (or, for a cancel or
// a reschedule, the card's own approval window).

/** A grant left unused this long lapses even if the hold is still good. */
export const GRANT_LIFETIME_MS = 5 * 60 * 1_000;

/** The person's click on Approve, as the app API's auth context saw it. */
export interface UserApproval {
  readonly userId: string;
  readonly proposalId: string;
  /** The fingerprint the card showed. */
  readonly fingerprint: string;
}

export interface Grant {
  readonly grantId: string;
  readonly proposalId: string;
  readonly fingerprint: string;
  readonly userId: string;
  readonly issuedAtMs: number;
  /** Never later than the hold's expiry (a change's approval window). */
  readonly expiresAtMs: number;
  /** Set when the grant is used; a used grant can't be used again. */
  readonly consumedAtMs?: number;
  /** Set when the terms it covered changed before it was used; a voided grant can never be used. */
  readonly voidedAtMs?: number;
}

export function grantFor(proposal: Proposal, approval: UserApproval, grantId: string, nowMs: number): Grant {
  const holdEndsMs = Date.parse(approvalDeadlineOf(proposal.terms));
  return {
    grantId,
    proposalId: proposal.proposalId,
    fingerprint: approval.fingerprint,
    userId: approval.userId,
    issuedAtMs: nowMs,
    expiresAtMs: Math.min(holdEndsMs, nowMs + GRANT_LIFETIME_MS),
  };
}

export function isGrantExpired(grant: Grant, nowMs: number): boolean {
  return nowMs > grant.expiresAtMs;
}

export function isConsumed(grant: Grant): boolean {
  return grant.consumedAtMs !== undefined;
}

export function isVoided(grant: Grant): boolean {
  return grant.voidedAtMs !== undefined;
}

/**
 * The key `book` (or `cancel`, or `reschedule`) is called with. Derived from the grant, so the one
 * grant can only ever have one effect: the world returns the first result for a repeated key
 * instead of acting again.
 */
export function idempotencyKeyOf(grant: Grant, action: ProposedAction): string {
  return `${action}:${grant.grantId}`;
}
