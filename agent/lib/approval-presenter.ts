import {
  VERIFYING_PROMISE,
  type ActionIntentView,
  type BookingChangeView,
  type BookingView,
  type ExecuteProposalOutput,
  type HoldSlotOutput,
  type ProposalCard,
  type ProposalTermsView,
  type ProposalView,
  type ProposeActionOutput,
  type TermChangeView,
} from "@errand/contracts";

import type { Grant } from "../../src/core/approval/grant";
import type { TermChange } from "../../src/core/approval/invalidation";
import type { BookingChangeTerms, Proposal, ProposalTerms } from "../../src/core/approval/proposal";
import type { ServiceCatalog } from "../../src/core/ports/service-catalog";
import type { BookingOutcome } from "../../src/core/use-cases/book-approved-proposal";
import type { ExecuteProposalOutcome } from "../../src/core/use-cases/execute-proposal";
import type { HoldSlotOutcome } from "../../src/core/use-cases/hold-slot";
import type { BookingChangeOutcome } from "../../src/core/use-cases/change-approved-booking";
import type { ApprovedBooking, BookingChangeApproval } from "../../src/core/use-cases/list-bookings";
import type { ProposalStanding } from "../../src/core/use-cases/list-proposals";
import type { ProposeBookingOutcome } from "../../src/core/use-cases/propose-booking";
import type { ProposeBookingChangeOutcome } from "../../src/core/use-cases/propose-booking-change";
import type { ActionIntentStanding, BookingNotice } from "../../src/core/use-cases/reconcile-pending-actions";
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

function presentTerms(terms: ProposalTerms): ProposalTermsView {
  const shared = {
    providerId: terms.providerId,
    providerName: terms.providerName,
    service: terms.service,
    rating: terms.rating,
    slot: { start: terms.slot.start, end: terms.slot.end },
    priceInr: terms.priceInr,
  };
  switch (terms.action) {
    case "book":
      return {
        ...shared,
        action: "book",
        area: terms.area,
        holdId: terms.holdId,
        holdExpiresAt: terms.holdExpiresAt,
        cancellationTerms: terms.cancellationTerms,
      };
    case "cancel":
      return {
        ...shared,
        action: "cancel",
        bookingId: terms.bookingId,
        bookingPriceInr: terms.bookingPriceInr,
        cancellationTerms: terms.cancellationTerms,
        expiresAt: terms.expiresAt,
      };
    case "reschedule":
      return {
        ...shared,
        action: "reschedule",
        bookingId: terms.bookingId,
        fromSlot: { start: terms.fromSlot.start, end: terms.fromSlot.end },
        expiresAt: terms.expiresAt,
      };
  }
}

export function presentProposalCard(proposal: Proposal): ProposalCard {
  return { proposalId: proposal.proposalId, status: proposal.status, terms: presentTerms(proposal.terms) };
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

function presentBookingChange({ proposal, grant }: BookingChangeApproval): BookingChangeView {
  return {
    proposalId: proposal.proposalId,
    action: proposal.terms.action,
    status: proposal.status,
    slot: { start: proposal.terms.slot.start, end: proposal.terms.slot.end },
    priceInr: proposal.terms.priceInr,
    proposalFingerprint: proposal.fingerprint,
    grantId: grant?.grantId ?? null,
    grantFingerprint: grant?.fingerprint ?? null,
    grantConsumed: grant?.consumedAtMs !== undefined,
  };
}

export function presentBooking({ booking, approval, changes }: ApprovedBooking): BookingView {
  return {
    bookingId: booking.bookingId,
    providerId: booking.providerId,
    providerName: booking.providerName,
    service: booking.service,
    slot: { start: booking.slot.start, end: booking.slot.end },
    priceInr: booking.priceInr,
    status: booking.status,
    cancelledBy: booking.cancelledBy ?? null,
    approval:
      approval === undefined || approval.proposal.terms.action !== "book"
        ? null
        : {
            proposalId: approval.proposal.proposalId,
            holdId: approval.proposal.terms.holdId,
            proposalFingerprint: approval.proposal.fingerprint,
            grantId: approval.grant?.grantId ?? null,
            grantFingerprint: approval.grant?.fingerprint ?? null,
            grantConsumed: approval.grant?.consumedAtMs !== undefined,
          },
    changes: changes.map(presentBookingChange),
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

/** "Approve ₹899" for a booking or a move; a cancellation's button names its fee, or says it's free. */
export function approveButtonOf(terms: ProposalTerms): string {
  if (terms.action !== "cancel") return `Approve ${rupees(terms.priceInr)}`;
  return terms.priceInr === 0 ? "Approve free cancellation" : `Approve ${rupees(terms.priceInr)}`;
}

function proposedChangeMessage(terms: BookingChangeTerms): string {
  const button = approveButtonOf(terms);
  if (terms.action === "cancel") {
    const fee = terms.priceInr === 0 ? "no cancellation fee" : `a cancellation fee of ${rupees(terms.priceInr)}`;
    return (
      `The cancellation card is on screen: ${terms.providerName}, ${when(terms.slot.start)}, booking ${terms.bookingId}, ${fee}. ` +
      `Ask the person to check it and tap ${button} if it's right. Nothing is cancelled until they tap it.`
    );
  }
  return (
    `The reschedule card is on screen: ${terms.providerName}, booking ${terms.bookingId}, from ${when(terms.fromSlot.start)} ` +
    `to ${when(terms.slot.start)}. Ask the person to check it and tap ${button} if it's right. Nothing moves until they tap it.`
  );
}

export function presentProposeChangeOutcome(outcome: ProposeBookingChangeOutcome): ProposeActionOutput {
  switch (outcome.kind) {
    case "proposed":
      return { kind: "proposed", proposal: presentProposalCard(outcome.proposal), message: proposedChangeMessage(outcome.proposal.terms) };
    case "booking_not_found":
      return { kind: "booking_not_found", message: "The person has no booking with that ID. Call list_bookings and use a bookingId from it." };
    case "not_changeable":
      return {
        kind: "not_changeable",
        bookingId: outcome.booking.bookingId,
        status: outcome.booking.status,
        message:
          outcome.booking.cancelledBy === "provider"
            ? "That booking was already cancelled by the provider, so there is nothing to cancel or move. Offer to find another provider."
            : `That booking is ${outcome.booking.status === "upcoming" ? "already under way" : outcome.booking.status}, so it can't be cancelled or moved.`,
      };
    case "same_slot":
      return { kind: "same_slot", bookingId: outcome.booking.bookingId, message: "The booking is already at that time. Ask which time they want instead." };
    case "slot_unavailable":
      return {
        kind: "slot_unavailable",
        bookingId: outcome.booking.bookingId,
        alternatives: outcome.alternatives.map((slot) => ({ start: slot.start, end: slot.end })),
        message:
          outcome.alternatives.length === 0
            ? "The provider has no free slot that day. Ask the person for another day, then call find_reschedule_slots."
            : `The provider doesn't have that slot free. Offer these instead: ${outcome.alternatives.map((slot) => when(slot.start)).join(", ")}.`,
      };
    case "provider_not_found":
      return { kind: "provider_not_found", message: "The booking's provider no longer exists, so it can't be changed here." };
  }
}

/** cancel or reschedule called without what it needs. */
export function presentMissingChangeDetails(missing: readonly ("booking_id" | "slot")[]): ProposeActionOutput {
  return {
    kind: "missing_details",
    missing: [...missing],
    message: `Pass ${missing.join(" and ")}: the bookingId from list_bookings${missing.includes("slot") ? ", and a slot from find_reschedule_slots" : ""}.`,
  };
}

function changeClause(change: TermChange, action: ProposalTerms["action"]): string {
  switch (change.field) {
    case "price":
      return `the ${action === "cancel" ? "cancellation fee" : "price"} went from ${rupees(change.from)} to ${rupees(change.to)}`;
    case "slot":
      return `the time went from ${when(change.from.start)} to ${when(change.to.start)}`;
    case "provider":
      return `the provider went from ${change.from.providerName} to ${change.to.providerName}`;
  }
}

/** "The price went from ₹899 to ₹1,050 and the time went from … to …". */
function whatChanged(changes: readonly TermChange[], action: ProposalTerms["action"] = "book"): string {
  const sentence = changes.map((change) => changeClause(change, action)).join(" and ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** What did not happen, in the action's words: "nothing was booked", "nothing was cancelled", "nothing moved". */
const NOTHING_DONE = { book: "nothing was booked", cancel: "nothing was cancelled", reschedule: "nothing was moved" } as const;

const ACTION_NOUN = { book: "booking", cancel: "cancellation", reschedule: "move" } as const;

function changeDescription(terms: BookingChangeTerms): string {
  return terms.action === "cancel"
    ? `your ${terms.providerName} visit on ${when(terms.slot.start)} (booking ${terms.bookingId})`
    : `your ${terms.providerName} visit (booking ${terms.bookingId}) from ${when(terms.fromSlot.start)} to ${when(terms.slot.start)}`;
}

function feeClause(feeInr: number): string {
  return feeInr === 0 ? "There's no cancellation fee." : `The cancellation fee was ${rupees(feeInr)}.`;
}

function bookingChangeMessage(outcome: BookingChangeOutcome): string {
  switch (outcome.kind) {
    case "cancelled": {
      const { terms } = outcome.proposal;
      return `Cancelled: ${changeDescription(terms)}. The provider's booking list confirms it. ${feeClause(terms.priceInr)}`;
    }
    case "rescheduled": {
      const { terms } = outcome.proposal;
      return `Moved: ${terms.providerName}, now ${when(terms.slot.start)} (was ${when(terms.fromSlot.start)}). Booking ID ${terms.bookingId}.`;
    }
    case "reschedule_conflict":
      return outcome.freshProposal === undefined
        ? `The provider can't take ${when(outcome.proposal.terms.slot.start)}, so nothing was moved, and it has no other free slot that day. Pick another day.`
        : `The provider can't take ${when(outcome.proposal.terms.slot.start)}, so nothing was moved. ` +
            `A new card offers ${when(outcome.freshProposal.terms.slot.start)} instead; tap Approve on it if that works, or pick another of the free slots.`;
    case "change_failed":
      return changeFailureMessage(outcome.proposal.terms.action, outcome.reason);
    case "change_verifying":
      return `I'm checking with the provider whether the ${ACTION_NOUN[outcome.proposal.terms.action]} went through. ${VERIFYING_PROMISE}`;
  }
}

function changeFailureMessage(action: BookingChangeTerms["action"], reason: string): string {
  if (reason === "service_unavailable") {
    return `The provider's system kept failing, so ${NOTHING_DONE[action]}: your booking is as it was. I can try again with a new card.`;
  }
  if (reason === "cancelled_by_provider") return `That booking was already cancelled by the provider, so ${NOTHING_DONE[action]}.`;
  if (reason === "booking_not_found" || reason === "booking_not_changeable") {
    return `That booking can no longer be changed (it's done, cancelled or under way), so ${NOTHING_DONE[action]}.`;
  }
  return `The provider couldn't make the change, so ${NOTHING_DONE[action]}.`;
}

function executeMessage(outcome: ExecuteProposalOutcome): string {
  switch (outcome.kind) {
    case "booked":
    case "already_booked": {
      const { terms } = outcome.proposal;
      return `Booked: ${terms.providerName}, ${when(terms.slot.start)}, ${rupees(terms.priceInr)}. Booking ID ${outcome.bookingId}.`;
    }
    case "cancelled":
    case "rescheduled":
    case "reschedule_conflict":
    case "change_failed":
    case "change_verifying":
      return bookingChangeMessage(outcome);
    case "already_changed":
      return outcome.proposal.terms.action === "cancel"
        ? `That booking (${outcome.proposal.terms.bookingId}) is already cancelled; nothing new was done.`
        : `That booking (${outcome.proposal.terms.bookingId}) was already moved; nothing new was done.`;
    case "booking_unavailable":
      return changeFailureMessage(
        outcome.proposal.terms.action === "cancel" ? "cancel" : "reschedule",
        outcome.cancelledByProvider ? "cancelled_by_provider" : "booking_not_changeable",
      );
    case "not_approved": {
      const { terms } = outcome.proposal;
      return (
        `Nothing is ${terms.action === "book" ? "booked" : "changed"} yet: only a tap on ${approveButtonOf(terms)} on the card can ` +
        `approve the ${ACTION_NOUN[terms.action]}, and a typed reply doesn't count. The card is shown again.`
      );
    }
    case "no_proposal":
      return "There is nothing to book yet. Choose an option first.";
    case "declined":
      return `You declined this ${ACTION_NOUN[outcome.proposal.terms.action]}, so ${NOTHING_DONE[outcome.proposal.terms.action]}.`;
    case "approval_expired":
      return outcome.proposal.terms.action === "book"
        ? "The approval ran out before the booking was made, so nothing was booked. I can hold the slot again."
        : `The approval ran out before it was used, so ${NOTHING_DONE[outcome.proposal.terms.action]}. I can show a new card.`;
    case "fingerprint_mismatch":
      return `The approval doesn't match this ${ACTION_NOUN[outcome.proposal.terms.action]}'s details, so ${NOTHING_DONE[outcome.proposal.terms.action]}. I'll show a new card.`;
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
      const { action } = outcome.freshProposal.terms;
      return (
        `${whatChanged(outcome.changes, action)} after you approved, so ${NOTHING_DONE[action]}. ` +
        `A new card shows the new terms: tap ${approveButtonOf(outcome.freshProposal.terms)} on it if you still want it.`
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
  if (outcome.kind === "approval_invalidated" || outcome.kind === "hold_reproposed" || outcome.kind === "reschedule_conflict") {
    return outcome.freshProposal;
  }
  return undefined;
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
export function presentBookingNotice(outcome: BookingNotice): string {
  switch (outcome.kind) {
    case "cancelled":
    case "rescheduled":
    case "reschedule_conflict":
    case "change_failed":
    case "change_verifying":
      return `Update on your booking: ${bookingChangeMessage(outcome)}`;
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
    holdId: intent.action === "book" ? intent.holdId : null,
    targetBookingId: intent.action === "book" ? null : intent.targetBookingId,
    newSlot: intent.action === "reschedule" ? { start: intent.newSlot.start, end: intent.newSlot.end } : null,
    state: intent.state,
    attempts: intent.attempts,
    createdAt: new Date(intent.createdAtMs).toISOString(),
    updatedAt: new Date(intent.updatedAtMs).toISOString(),
    lastAttemptAt: isoOrNull(intent.lastAttemptAtMs),
    bookingId: (intent.action === "book" ? intent.bookingId : undefined) ?? null,
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
    ...(outcome.kind === "reschedule_conflict" ? { alternativeSlots: outcome.alternatives.map((slot) => ({ start: slot.start, end: slot.end })) } : {}),
    message: executeMessage(outcome),
  };
}
