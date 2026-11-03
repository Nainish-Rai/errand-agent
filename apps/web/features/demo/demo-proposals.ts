import type { ActionIntentView, ApproveProposalResponse, BookingView, ProposalView } from "@errand/contracts";

import { demoNowMs, demoState, rewrite, type DemoProposal } from "./demo-world";
import { proposalAt, recording, type RecordedFlow } from "./recording";

// A demo proposal is a recorded one replayed under its own id: the recorded card's terms, fingerprint
// and grant, with the status the visitor's taps gave it and a hold counted from when it was made. The
// booking's ledger replays the steps the real ledger took for it (pending, the timed-out reply as
// `unknown`, then confirmed by the status check), spread over a couple of seconds so the chat's
// "Checking with the provider…" is there to see.

/** How long the core's hold lasts. */
export const HOLD_SECONDS = 600;

/** When each recorded ledger step shows, after Approve. The last is the confirmation. */
const LEDGER_STEP_MS = [0, 350, 900, 2_700];

/** How long the booking takes from Approve to the receipt. */
export const BOOKING_MS = 2_900;

function recordedProposalIds(): Set<string> {
  return new Set(Object.values(recording.proposals).map((proposal) => proposal.proposalId));
}

/** The recorded ids a demo proposal stands in for: every recorded proposal, and the recorded chat's session. */
export function replacementsFor(proposal: DemoProposal): Record<string, string> {
  const pending = proposalAt(proposal.flow, "pending");
  return {
    ...Object.fromEntries([...recordedProposalIds()].map((id) => [id, proposal.id])),
    ...(pending === undefined ? {} : { [pending.sessionId]: proposal.sessionId }),
  };
}

export function holdSecondsLeft(proposal: DemoProposal): number {
  return Math.max(0, HOLD_SECONDS - Math.floor((demoNowMs() - proposal.createdAtMs) / 1_000));
}

export function proposalView(proposal: DemoProposal): ProposalView {
  const pending = proposalAt(proposal.flow, "pending");
  if (pending === undefined) throw new Error(`No recorded proposal for ${proposal.flow}.`);
  const replace = replacementsFor(proposal);
  const live: ProposalView = {
    ...rewrite(pending, replace),
    createdAt: new Date(proposal.createdAtMs).toISOString(),
    holdSecondsLeft: holdSecondsLeft(proposal),
  };
  const terms = live.terms.action === "book" ? { ...live.terms, holdExpiresAt: new Date(proposal.createdAtMs + HOLD_SECONDS * 1_000).toISOString() } : live.terms;
  switch (proposal.phase) {
    case "pending":
      return { ...live, terms };
    case "declined":
      return { ...live, terms, status: "declined", holdSecondsLeft: 0 };
    case "approved":
    case "executed": {
      const recorded = proposalAt(proposal.flow, proposal.phase) ?? proposalAt(proposal.flow, "executed") ?? proposalAt(proposal.flow, "approved");
      return recorded === undefined ? { ...live, status: "approved" } : rewrite(recorded, replace);
    }
  }
}

export function approvalOf(proposal: DemoProposal): ApproveProposalResponse {
  const recorded = recording.proposals[`${proposal.flow}:approve`] as ApproveProposalResponse | undefined;
  if (recorded === undefined) throw new Error(`No recorded approval for ${proposal.flow}.`);
  return rewrite(recorded, replacementsFor(proposal));
}

function intentsAt(flow: RecordedFlow, phase: "settled" | "during"): unknown {
  return recording.intents[`${flow}:${phase}`];
}

/** The proposal's booking intent as the ledger has it now. */
export function intentOf(proposal: DemoProposal): ActionIntentView | undefined {
  if (proposal.phase !== "approved" && proposal.phase !== "executed") return undefined;
  const settled = (intentsAt(proposal.flow, "settled") as readonly ActionIntentView[] | undefined)?.find((intent) => intent.action === "book");
  if (settled === undefined) return undefined;
  const replace = replacementsFor(proposal);
  const during = intentsAt(proposal.flow, "during") as readonly (readonly ActionIntentView[])[] | undefined;
  if (proposal.phase === "approved" && during !== undefined && proposal.approvedAtMs !== undefined) {
    const elapsed = demoNowMs() - proposal.approvedAtMs;
    const step = LEDGER_STEP_MS.findLastIndex((at) => elapsed >= at);
    const snapshot = during[Math.min(Math.max(step, 0), during.length - 1)]?.[0];
    if (snapshot !== undefined) return rewrite(snapshot, replace);
  }
  return rewrite(settled, replace);
}

export function sessionIntents(sessionId: string): ActionIntentView[] {
  return Object.values(demoState().proposals)
    .filter((proposal) => proposal.sessionId === sessionId)
    .sort((a, b) => a.createdAtMs - b.createdAtMs)
    .flatMap((proposal) => {
      const intent = intentOf(proposal);
      return intent === undefined ? [] : [intent];
    });
}

/** The booking a demo proposal made, as GET /bookings shows it. */
export function bookingOf(proposal: DemoProposal): BookingView | undefined {
  if (proposal.phase !== "executed") return undefined;
  const pending = proposalAt(proposal.flow, "pending");
  const recorded = recording.bookings.afterBooking.find((booking) => booking.approval?.proposalId === pending?.proposalId);
  if (recorded !== undefined) return rewrite(recorded, replacementsFor(proposal));
  const view = proposalView(proposal);
  const intent = intentOf(proposal);
  if (view.terms.action !== "book" || intent?.bookingId == null) return undefined;
  return {
    bookingId: intent.bookingId,
    providerId: view.terms.providerId,
    providerName: view.terms.providerName,
    service: view.terms.service,
    slot: view.terms.slot,
    priceInr: view.terms.priceInr,
    status: "upcoming",
    cancelledBy: null,
    approval: null,
    changes: [],
  };
}
