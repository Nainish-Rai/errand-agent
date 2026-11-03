import type { Hasher } from "../ports/hasher";
import { cancellationFeeOf } from "../booking/cancellation-fee";
import type { Booking, Hold, ProviderDetails, ServiceKind, Slot } from "../ports/provider-world";
import { fingerprintOf, type FingerprintedTerms } from "./fingerprint";
import type { ProposalInvalidation } from "./invalidation";

// A proposal is an action the agent wants to take, frozen with every material detail the person
// will see on the approval card. The details come from the world (the live hold, the booking and the
// provider's own record), never from the model's arguments, so the card can't show what the provider
// didn't quote. Booking a held slot, cancelling a booking and moving one are all proposals: each
// needs its own card and its own tap on Approve.

export type ProposalStatus =
  /** On the card, waiting for the person. */
  | "pending"
  /** The person clicked Approve; a grant exists and nothing has been booked yet. */
  | "approved"
  | "declined"
  /** The hold (and with it any grant) ran out before the booking was made. */
  | "expired"
  /** The provider changed the price, slot or provider after the approval; its grant was voided. */
  | "voided"
  /** The grant was used and `book` was called; the outcome isn't known yet. */
  | "executing"
  /** The world's status confirmed it: the booking exists, or the change to it took effect. */
  | "executed"
  /** The outcome is unknown (a timeout the status check couldn't settle). */
  | "verifying"
  | "failed";

export type BookingTerms = Extract<FingerprintedTerms, { readonly action: "book" }> & {
  readonly providerName: string;
  readonly service: ServiceKind;
  readonly rating: number;
  /** Where the visit happens: the errand's area. */
  readonly area: string;
  readonly cancellationTerms: string;
  readonly holdExpiresAt: string;
};

/** How long a cancel or reschedule card can be approved. It rests on no hold, so it lapses on its own, like one. */
export const CHANGE_APPROVAL_WINDOW_MS = 10 * 60 * 1_000;

interface ChangedBooking {
  readonly bookingId: string;
  readonly providerName: string;
  readonly service: ServiceKind;
  readonly rating: number;
  /** When the card stops being approvable. */
  readonly expiresAt: string;
}

/** Cancelling a booking. `slot` is the booking's visit and `priceInr` the fee the provider charges for cancelling now. */
export type CancellationTerms = Extract<FingerprintedTerms, { readonly action: "cancel" }> &
  ChangedBooking & {
    /** What the booking itself costs, for the card; it isn't what this approval moves. */
    readonly bookingPriceInr: number;
    readonly cancellationTerms: string;
  };

/** Moving a booking. `slot` is the new visit and `priceInr` the booking's price, which a move doesn't change. */
export type RescheduleTerms = Extract<FingerprintedTerms, { readonly action: "reschedule" }> &
  ChangedBooking & {
    /** The visit as booked now, shown next to the new one. */
    readonly fromSlot: Slot;
  };

export type BookingChangeTerms = CancellationTerms | RescheduleTerms;

export type ProposalTerms = BookingTerms | BookingChangeTerms;

export interface ProposalOf<Terms extends ProposalTerms> {
  readonly proposalId: string;
  readonly sessionId: string;
  /** The person the proposal is for; only they can approve or decline it. */
  readonly userId: string;
  readonly terms: Terms;
  readonly fingerprint: string;
  readonly status: ProposalStatus;
  readonly createdAtMs: number;
  /** Set once a booking this proposal made is verified. A change names its booking in its terms instead. */
  readonly bookingId?: string;
  /** Set when the live terms or an expired hold made the proposal void and a fresh one replaced it. */
  readonly invalidation?: ProposalInvalidation;
}

export type BookingProposal = ProposalOf<BookingTerms>;

export type BookingChangeProposal = ProposalOf<CancellationTerms> | ProposalOf<RescheduleTerms>;

export type Proposal = BookingProposal | BookingChangeProposal;

export function isBookingProposal(proposal: Proposal): proposal is BookingProposal {
  return proposal.terms.action === "book";
}

export function isBookingChangeProposal(proposal: Proposal): proposal is BookingChangeProposal {
  return proposal.terms.action !== "book";
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

function changedBooking(booking: Booking, provider: ProviderDetails, nowMs: number): ChangedBooking {
  return {
    bookingId: booking.bookingId,
    providerName: booking.providerName,
    service: booking.service,
    rating: provider.rating,
    expiresAt: new Date(nowMs + CHANGE_APPROVAL_WINDOW_MS).toISOString(),
  };
}

/** The terms of cancelling a booking now, read from the world's booking and the provider's rule, never from the model. */
export function cancellationTermsOf(booking: Booking, provider: ProviderDetails, nowMs: number): CancellationTerms {
  return {
    ...changedBooking(booking, provider, nowMs),
    action: "cancel",
    providerId: booking.providerId,
    slot: { start: booking.slot.start, end: booking.slot.end },
    priceInr: cancellationFeeOf(provider.cancellationPolicy, booking, nowMs),
    bookingPriceInr: booking.priceInr,
    cancellationTerms: provider.cancellationTerms,
  };
}

/** The terms of moving a booking to `slot`, a slot the provider has free. */
export function rescheduleTermsOf(booking: Booking, provider: ProviderDetails, slot: Slot, nowMs: number): RescheduleTerms {
  return {
    ...changedBooking(booking, provider, nowMs),
    action: "reschedule",
    providerId: booking.providerId,
    slot: { start: slot.start, end: slot.end },
    fromSlot: { start: booking.slot.start, end: booking.slot.end },
    priceInr: booking.priceInr,
  };
}

export function proposeTerms<Terms extends ProposalTerms>(
  terms: Terms,
  who: { readonly proposalId: string; readonly sessionId: string; readonly userId: string },
  hasher: Hasher,
  atMs: number,
): ProposalOf<Terms> {
  return { ...who, terms, fingerprint: fingerprintOf(terms, hasher), status: "pending", createdAtMs: atMs };
}

/** A pending proposal for a cancellation or a reschedule, typed by its action. */
export function proposeChange(
  terms: BookingChangeTerms,
  who: { readonly proposalId: string; readonly sessionId: string; readonly userId: string },
  hasher: Hasher,
  atMs: number,
): BookingChangeProposal {
  return terms.action === "cancel" ? proposeTerms(terms, who, hasher, atMs) : proposeTerms(terms, who, hasher, atMs);
}

/** When the card stops being approvable: the hold's expiry for a booking, the change's own window otherwise. */
export function approvalDeadlineOf(terms: ProposalTerms): string {
  return terms.action === "book" ? terms.holdExpiresAt : terms.expiresAt;
}

/** The hold behind a booking proposal, or a change's approval window, has run out: nothing can be done on it. */
export function isHoldExpired(proposal: Proposal, nowMs: number): boolean {
  return nowMs > Date.parse(approvalDeadlineOf(proposal.terms));
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

/** Past the point of no return: `book`, `cancel` or `reschedule` has been (or is being) called for it. */
export function isExecutionStarted(proposal: Proposal): boolean {
  return ["executing", "executed", "verifying", "failed"].includes(proposal.status);
}
