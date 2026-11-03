import { createHash } from "node:crypto";

import type { ApiClient, ChatTurn, ToolCallView } from "@errand/client";
import {
  ExecuteProposalOutputSchema,
  ProposeActionOutputSchema,
  type BookingTermsView,
  type BookingView,
  type ExecuteProposalOutput,
  type ProposalCard,
} from "@errand/contracts";

// Reads the approval side of a run: the cards the chat showed, what execute_proposal returned,
// and the bookings the world made during the run. Grades state, never wording.

function outputsOf<T>(calls: readonly ToolCallView[], name: string, parse: (value: unknown) => T): T[] {
  return calls.filter((call) => call.name === name && call.output !== undefined).map((call) => parse(call.output));
}

export function executionsIn(turn: ChatTurn | undefined): ExecuteProposalOutput[] {
  return outputsOf(turn?.toolCalls ?? [], "execute_proposal", (value) => ExecuteProposalOutputSchema.parse(value));
}

/**
 * The approval cards a turn put on screen, in order: every proposal propose_action returned, every
 * card execute_proposal handed back because nobody had tapped Approve, and the voided (or expired)
 * card with the fresh one under it when the terms changed or the hold ran out.
 */
export function cardsIn(turn: ChatTurn | undefined): ProposalCard[] {
  return (turn?.toolCalls ?? []).flatMap((call) => {
    if (call.output === undefined) return [];
    if (call.name === "propose_action") {
      const output = ProposeActionOutputSchema.parse(call.output);
      return output.kind === "proposed" ? [output.proposal] : [];
    }
    if (call.name === "execute_proposal") {
      const output = ExecuteProposalOutputSchema.parse(call.output);
      if (output.proposal !== null && output.freshProposal !== null) return [output.proposal, output.freshProposal];
      return output.kind === "not_approved" && output.proposal !== null ? [output.proposal] : [];
    }
    return [];
  });
}

/** The card the person would see last in the chat, as the web app's thread shows it. */
export function latestCard(turns: readonly ChatTurn[]): ProposalCard | undefined {
  return turns.flatMap((turn) => cardsIn(turn)).at(-1);
}

/**
 * The fingerprint of a booking's terms, derived here independently of the backend: SHA-256 over
 * the JSON array [action, provider, slot start, slot end, price, hold]. If the backend's
 * fingerprint ever stops covering one of these, the invariants stop matching.
 */
export function expectedFingerprint(terms: Pick<BookingTermsView, "providerId" | "slot" | "priceInr" | "holdId">): string {
  const text = JSON.stringify(["book", terms.providerId, terms.slot.start, terms.slot.end, terms.priceInr, terms.holdId]);
  return `fp_${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

/** The fingerprint the world's booking itself implies, with the hold its approval names. */
export function fingerprintOfBooking(booking: BookingView): string | undefined {
  if (booking.approval === null) return undefined;
  return expectedFingerprint({ ...booking, holdId: booking.approval.holdId });
}

const istFormat = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

/** A slot's start as the person reads it: "Thu, 5 Nov, 8:00 am IST". */
export function istLabel(start: string): string {
  return `${istFormat.format(new Date(start))} IST`;
}

/** "₹1,050". */
export function rupeeLabel(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

export interface BookingChanges {
  /** Bookings the world has now that it didn't have when the scenario started. */
  readonly made: readonly BookingView[];
  /** Bookings that existed at the start and were cancelled or moved since. */
  readonly altered: readonly BookingView[];
}

/** What the booking checks read from a run: the API, and the bookings the world started with. */
export interface BookingRun {
  readonly api: Pick<ApiClient, "listBookings">;
  readonly bookingsBefore: readonly BookingView[];
}

export async function bookingChanges(run: BookingRun): Promise<BookingChanges> {
  const before = new Map(run.bookingsBefore.map((booking) => [booking.bookingId, booking]));
  const after = await run.api.listBookings();
  return {
    made: after.filter((booking) => !before.has(booking.bookingId)),
    altered: after.filter((booking) => {
      const was = before.get(booking.bookingId);
      return was !== undefined && (was.status !== booking.status || was.slot.start !== booking.slot.start);
    }),
  };
}
