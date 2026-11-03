import {
  VERIFYING_PROMISE,
  type ActionIntentView,
  type BookingView,
  type ExecuteProposalOutput,
  type HoldSlotOutput,
  type ProposalCard,
  type ProposalView,
  type ProposeActionOutput,
  type TermChangeView,
} from "@errand/contracts";

import type { Grant } from "../../src/core/approval/grant";
import type { TermChange } from "../../src/core/approval/invalidation";
import type { Proposal } from "../../src/core/approval/proposal";
import type { ServiceCatalog } from "../../src/core/ports/service-catalog";
import type { BookingOutcome } from "../../src/core/use-cases/book-approved-proposal";
import type { ExecuteProposalOutcome } from "../../src/core/use-cases/execute-proposal";
import type { HoldSlotOutcome } from "../../src/core/use-cases/hold-slot";
import type { ApprovedBooking } from "../../src/core/use-cases/list-bookings";
import type { ProposalStanding } from "../../src/core/use-cases/list-proposals";
import type { ProposeBookingOutcome } from "../../src/core/use-cases/propose-booking";
import type { ActionIntentStanding } from "../../src/core/use-cases/reconcile-pending-actions";
import { presentErrand, presentOptions } from "./errand-presenter";

// Core's hold, proposal and booking outcomes to wire shapes, and the one place their user-facing
// words live. The agent relays `message`; it never writes its own "booked".

const whenFormat = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

export function when(start: string): string {
  return `${whenFormat.format(new Date(start))} IST`;
}

function rupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

export function presentProposalCard(proposal: Proposal): ProposalCard {
  const { terms } = proposal;
  return {
    proposalId: proposal.proposalId,
    status: proposal.status,
    terms: {
      action: terms.action,
      providerId: terms.providerId,
      providerName: terms.providerName,
      service: terms.service,
      rating: terms.rating,
      area: terms.area,
      slot: { start: terms.slot.start, end: terms.slot.end },
      priceInr: terms.priceInr,
      holdId: terms.holdId,
      holdExpiresAt: terms.holdExpiresAt,
      cancellationTerms: terms.cancellationTerms,
    },
  };
}

function presentGrant(grant: Grant) {
  return {
    grantId: grant.grantId,
    fingerprint: grant.fingerprint,
    expiresAt: new Date(grant.expiresAtMs).toISOString(),
    consumed: grant.consumedAtMs !== undefined,
    voided: grant.voidedAtMs !== undefined,
  };
}

function presentTermChange(change: TermChange): TermChangeView {
  switch (change.field) {
    case "price":
      return { field: "price", from: change.from, to: change.to };
    case "slot":
      return { field: "slot", from: { ...change.from }, to: { ...change.to } };
    case "provider":
      return { field: "provider", from: { ...change.from }, to: { ...change.to } };
  }
}

export function presentProposalView(standing: ProposalStanding): ProposalView {
  const { proposal, grant } = standing;
  return {
    ...presentProposalCard(proposal),
    sessionId: proposal.sessionId,
    fingerprint: proposal.fingerprint,
    createdAt: new Date(proposal.createdAtMs).toISOString(),
    holdSecondsLeft: Math.floor(standing.holdLeftMs / 1_000),
    bookingId: proposal.bookingId ?? null,
    grant: grant === undefined ? null : presentGrant(grant),
    invalidation:
      proposal.invalidation === undefined
        ? null
        : {
            changes: proposal.invalidation.changes.map(presentTermChange),
            replacedBy: proposal.invalidation.replacedBy,
            at: new Date(proposal.invalidation.atMs).toISOString(),
          },
  };
}

export function presentBooking({ booking, approval }: ApprovedBooking): BookingView {
  return {
    bookingId: booking.bookingId,
    providerId: booking.providerId,
    providerName: booking.providerName,
    service: booking.service,
    slot: { start: booking.slot.start, end: booking.slot.end },
    priceInr: booking.priceInr,
    status: booking.status,
    approval:
      approval === undefined
        ? null
        : {
            proposalId: approval.proposal.proposalId,
            holdId: approval.proposal.terms.holdId,
            proposalFingerprint: approval.proposal.fingerprint,
            grantId: approval.grant?.grantId ?? null,
            grantFingerprint: approval.grant?.fingerprint ?? null,
            grantConsumed: approval.grant?.consumedAtMs !== undefined,
          },
  };
}

export function presentHoldOutcome(outcome: HoldSlotOutcome, catalog: ServiceCatalog): HoldSlotOutput {
  switch (outcome.kind) {
    case "held": {
      const { hold } = outcome;
      return {
        kind: "held",
        hold: { holdId: hold.holdId, providerId: hold.providerId, slot: { ...hold.slot }, quotedPriceInr: hold.quotedPriceInr, expiresAt: hold.expiresAt },
        errand: presentErrand(outcome.errand, catalog),
        message: "The slot is held. Call propose_action with action book now, so the person gets the approval card.",
      };
    }
    case "slot_unavailable":
      return {
        kind: "slot_unavailable",
        errand: presentErrand(outcome.errand, catalog),
        message: "That slot is no longer free. Offer another slot or another option.",
      };
    case "provider_not_found":
      return { kind: "provider_not_found", errand: presentErrand(outcome.errand, catalog), message: "No provider has that id." };
    case "provider_excluded":
      return {
        kind: "provider_excluded",
        errand: presentErrand(outcome.errand, catalog),
        message: `${outcome.providerName} cancelled the booking this replaces, so it can't be offered again. Pick another option.`,
      };
    case "not_choosing":
      return {
        kind: "not_choosing",
        state: outcome.state,
        message: "A slot can be held only while options are on screen. Search first, or let the person finish with the card that is up.",
      };
  }
}

export function presentProposeOutcome(outcome: ProposeBookingOutcome): ProposeActionOutput {
  switch (outcome.kind) {
    case "proposed": {
      const { terms } = outcome.proposal;
      return {
        kind: "proposed",
        proposal: presentProposalCard(outcome.proposal),
        message:
          `The approval card is on screen: ${terms.providerName}, ${when(terms.slot.start)}, ${rupees(terms.priceInr)}. ` +
          `Ask the person to check it and tap Approve ${rupees(terms.priceInr)} if it's right. Nothing is booked until they tap it.`,
      };
    }
    case "no_hold":
      return { kind: "no_hold", message: "Nothing is held. Hold the chosen slot with hold_slot first." };
    case "hold_expired":
      return { kind: "hold_expired", message: "The hold ran out before the card was shown. Hold the slot again." };
    case "provider_not_found":
      return { kind: "provider_not_found", message: "The held provider no longer exists. Show the options again." };
  }
}

function changeClause(change: TermChange): string {
  switch (change.field) {
    case "price":
      return `the price went from ${rupees(change.from)} to ${rupees(change.to)}`;
    case "slot":
      return `the time went from ${when(change.from.start)} to ${when(change.to.start)}`;
    case "provider":
      return `the provider went from ${change.from.providerName} to ${change.to.providerName}`;
  }
}

/** "The price went from ₹899 to ₹1,050 and the time went from … to …". */
function whatChanged(changes: readonly TermChange[]): string {
  const sentence = changes.map(changeClause).join(" and ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function executeMessage(outcome: ExecuteProposalOutcome): string {
  switch (outcome.kind) {
    case "booked":
    case "already_booked": {
      const { terms } = outcome.proposal;
      return `Booked: ${terms.providerName}, ${when(terms.slot.start)}, ${rupees(terms.priceInr)}. Booking ID ${outcome.bookingId}.`;
    }
    case "not_approved":
      return (
        `Nothing is booked yet: only a tap on Approve ${rupees(outcome.proposal.terms.priceInr)} on the card can book it, ` +
        "and a typed reply doesn't count. The card is shown again."
      );
    case "no_proposal":
      return "There is nothing to book yet. Choose an option first.";
    case "declined":
      return "You declined this booking, so nothing was booked.";
    case "approval_expired":
      return "The approval ran out before the booking was made, so nothing was booked. I can hold the slot again.";
    case "fingerprint_mismatch":
      return "The approval doesn't match this booking's details, so nothing was booked. I'll show a new card.";
    case "out_of_step":
      return "That approval is no longer current, so nothing was booked. Let's look at the options again.";
    case "slot_taken":
      return outcome.alternatives.length === 0
        ? "Someone else booked that slot just before us, so nothing was booked. Let's look at the options again."
        : "Someone else booked that slot just before us, so nothing was booked. " +
            "Here are the next options; choosing one shows a new approval card to approve.";
    case "verifying":
      return VERIFYING_MESSAGE;
    case "booking_failed":
      return failureMessage(outcome.reason);
    case "approval_invalidated": {
      const price = rupees(outcome.freshProposal.terms.priceInr);
      return (
        `${whatChanged(outcome.changes)} after you approved, so I booked nothing. ` +
        `A new card shows the new terms: tap Approve ${price} on it if you still want it.`
      );
    }
    case "hold_reproposed": {
      const price = rupees(outcome.freshProposal.terms.priceInr);
      const changed = outcome.changes.length === 0 ? "" : ` ${whatChanged(outcome.changes)}.`;
      return (
        "The hold on that slot ran out before the booking went through, so nothing was booked. " +
        `I've held the slot again.${changed} Tap Approve ${price} on the new card to book it.`
      );
    }
    case "hold_lost":
      return "The hold on that slot ran out and the slot is no longer free, so nothing was booked. Pick another option.";
  }
}

function freshProposalOf(outcome: ExecuteProposalOutcome): Proposal | undefined {
  return outcome.kind === "approval_invalidated" || outcome.kind === "hold_reproposed" ? outcome.freshProposal : undefined;
}

function changesOf(outcome: ExecuteProposalOutcome): readonly TermChange[] {
  return outcome.kind === "approval_invalidated" || outcome.kind === "hold_reproposed" ? outcome.changes : [];
}

const VERIFYING_MESSAGE =
  "The provider didn't confirm in time, so I'm checking with them whether the booking went through. " + VERIFYING_PROMISE;

function failureMessage(reason: string): string {
  if (reason === "hold_expired" || reason === "hold_not_found") {
    return "The hold on that slot ran out before the provider confirmed, so nothing was booked.";
  }
  return "The provider couldn't take the booking, so nothing was booked.";
}

/** A settlement the reconciler reached outside the person's turn, as the booking update they are owed. */
export function presentBookingNotice(outcome: BookingOutcome): string {
  switch (outcome.kind) {
    case "booked": {
      const { terms } = outcome.proposal;
      return (
        `Update on your booking: the provider confirmed it. Booked: ${terms.providerName}, ${when(terms.slot.start)}, ` +
        `${rupees(terms.priceInr)}. Booking ID ${outcome.bookingId}.`
      );
    }
    case "slot_taken":
      return "Update on your booking: someone else got that slot first, so nothing was booked. Pick another option.";
    case "booking_failed":
      return `Update on your booking: ${failureMessage(outcome.reason)}`;
    case "verifying":
      return VERIFYING_MESSAGE;
  }
}

function isoOrNull(ms: number | undefined): string | null {
  return ms === undefined ? null : new Date(ms).toISOString();
}

export function presentActionIntent({ intent, notice }: ActionIntentStanding): ActionIntentView {
  return {
    idempotencyKey: intent.idempotencyKey,
    action: intent.action,
    proposalId: intent.proposalId,
    grantId: intent.grantId,
    sessionId: intent.sessionId,
    holdId: intent.holdId,
    state: intent.state,
    attempts: intent.attempts,
    createdAt: new Date(intent.createdAtMs).toISOString(),
    updatedAt: new Date(intent.updatedAtMs).toISOString(),
    lastAttemptAt: isoOrNull(intent.lastAttemptAtMs),
    bookingId: intent.bookingId ?? null,
    failureReason: intent.failureReason ?? null,
    resolvedAt: isoOrNull(intent.resolvedAtMs),
    resolvedBy: intent.resolvedBy ?? null,
    notice: notice === undefined ? null : presentBookingNotice(notice),
    noticeDeliveredAt: isoOrNull(intent.noticeDeliveredAtMs),
  };
}

export function presentExecuteOutcome(outcome: ExecuteProposalOutcome): ExecuteProposalOutput {
  const fresh = freshProposalOf(outcome);
  return {
    kind: outcome.kind,
    proposal: outcome.kind === "no_proposal" ? null : presentProposalCard(outcome.proposal),
    changes: changesOf(outcome).map(presentTermChange),
    freshProposal: fresh === undefined ? null : presentProposalCard(fresh),
    bookingId: outcome.kind === "booked" || outcome.kind === "already_booked" ? outcome.bookingId : null,
    ...(outcome.kind === "slot_taken" ? { options: presentOptions(outcome.alternatives) } : {}),
    message: executeMessage(outcome),
  };
}
