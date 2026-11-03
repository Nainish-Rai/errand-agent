import type { Hasher } from "../ports/hasher";
import type { Hold, ProviderDetails, ServiceKind, Slot } from "../ports/provider-world";
import { fingerprintOf, type FingerprintedTerms } from "./fingerprint";

// A proposal is an action the agent wants to take, frozen with every material detail the person
// will see on the approval card. The details come from the world (the live hold and the provider's
// own record), never from the model's arguments, so the card can't show what the provider didn't quote.

export type ProposalStatus =
  /** On the card, waiting for the person. */
  | "pending"
  /** The person clicked Approve; a grant exists and nothing has been booked yet. */
  | "approved"
  | "declined"
  /** The hold (and with it any grant) ran out before the booking was made. */
  | "expired"
  /** The grant was used and `book` was called; the outcome isn't known yet. */
  | "executing"
  /** `book` returned and `get_booking_status` confirmed the booking. */
  | "executed"
  /** The outcome is unknown (a timeout the status check couldn't settle). */
  | "verifying"
  | "failed";

export interface BookingTerms extends FingerprintedTerms {
  readonly action: "book";
  readonly providerName: string;
  readonly service: ServiceKind;
  readonly rating: number;
  /** Where the visit happens: the errand's area. */
  readonly area: string;
  readonly cancellationTerms: string;
  readonly holdExpiresAt: string;
}

export interface Proposal {
  readonly proposalId: string;
  readonly sessionId: string;
  /** The person the proposal is for; only they can approve or decline it. */
  readonly userId: string;
  readonly terms: BookingTerms;
  readonly fingerprint: string;
  readonly status: ProposalStatus;
  readonly createdAtMs: number;
  /** Set once the booking is verified. */
  readonly bookingId?: string;
}

/** The terms of booking a held slot, read from the hold and the provider, never from the model. */
export function bookingTermsOf(hold: Hold, provider: ProviderDetails, area: string): BookingTerms {
  const slot: Slot = { start: hold.slot.start, end: hold.slot.end };
  return {
    action: "book",
    providerId: hold.providerId,
    slot,
    priceInr: hold.quotedPriceInr,
    holdId: hold.holdId,
    providerName: provider.name,
    service: provider.service,
    rating: provider.rating,
    area,
    cancellationTerms: provider.cancellationTerms,
    holdExpiresAt: hold.expiresAt,
  };
}

export function proposeTerms(
  terms: BookingTerms,
  who: { readonly proposalId: string; readonly sessionId: string; readonly userId: string },
  hasher: Hasher,
  atMs: number,
): Proposal {
  return { ...who, terms, fingerprint: fingerprintOf(terms, hasher), status: "pending", createdAtMs: atMs };
}

/** The hold behind the proposal has run out, so nothing can be booked on it. */
export function isHoldExpired(proposal: Proposal, nowMs: number): boolean {
  return nowMs > Date.parse(proposal.terms.holdExpiresAt);
}

/** Still waiting for the person, and the hold is still ours. */
export function isAwaitingApproval(proposal: Proposal, nowMs: number): boolean {
  return proposal.status === "pending" && !isHoldExpired(proposal, nowMs);
}

/** The status as the person should see it: a pending proposal whose hold ran out reads as expired. */
export function currentStatus(proposal: Proposal, nowMs: number): ProposalStatus {
  if ((proposal.status === "pending" || proposal.status === "approved") && isHoldExpired(proposal, nowMs)) return "expired";
  return proposal.status;
}

/** Past the point of no return: `book` has been (or is being) called for it. */
export function isExecutionStarted(proposal: Proposal): boolean {
  return ["executing", "executed", "verifying", "failed"].includes(proposal.status);
}
