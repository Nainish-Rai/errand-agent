import type {
  BookingView,
  ExecuteProposalOutput,
  HoldSlotOutput,
  ProposalCard,
  ProposalView,
  ProposeActionOutput,
} from "@errand/contracts";

import type { Grant } from "../../src/core/approval/grant";
import type { Proposal } from "../../src/core/approval/proposal";
import type { ServiceCatalog } from "../../src/core/ports/service-catalog";
import type { ExecuteProposalOutcome } from "../../src/core/use-cases/execute-proposal";
import type { HoldSlotOutcome } from "../../src/core/use-cases/hold-slot";
import type { ApprovedBooking } from "../../src/core/use-cases/list-bookings";
import type { ProposalStanding } from "../../src/core/use-cases/list-proposals";
import type { ProposeBookingOutcome } from "../../src/core/use-cases/propose-booking";
import { presentErrand } from "./errand-presenter";

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

function when(start: string): string {
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
  };
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
    case "grant_used":
      return "This approval was already used. I'm checking the booking's status with the provider.";
    case "out_of_step":
      return "That approval is no longer current, so nothing was booked. Let's look at the options again.";
    case "slot_taken":
      return "Someone else took that slot before it could be booked. Nothing was booked and you weren't charged. Pick another option.";
    case "verifying":
      return "The provider didn't answer in time, so I'm verifying whether the booking went through. I'll tell you as soon as I know.";
    case "booking_failed":
      return "The provider couldn't take the booking. Nothing was booked and you weren't charged.";
  }
}

export function presentExecuteOutcome(outcome: ExecuteProposalOutcome): ExecuteProposalOutput {
  return {
    kind: outcome.kind,
    proposal: outcome.kind === "no_proposal" ? null : presentProposalCard(outcome.proposal),
    bookingId: outcome.kind === "booked" || outcome.kind === "already_booked" ? outcome.bookingId : null,
    message: executeMessage(outcome),
  };
}
