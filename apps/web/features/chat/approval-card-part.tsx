"use client";

import { useAuiState, type ToolCallMessagePartComponent } from "@assistant-ui/react";
import { ApiRequestError } from "@errand/client";
import {
  CARD_FOLLOW_UPS,
  ExecuteProposalOutputSchema,
  ProposeActionOutputSchema,
  type ExecuteProposalOutput,
  type ProposalCard,
  type ProposalView,
  type TermChangeView,
} from "@errand/contracts";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import type { MonogramTone } from "@/components/monogram";
import { Spinner } from "@/components/ui/spinner";
import { ApprovalCard, BookingReceipt, ChangeReceipt, type ApprovalChange, type ApprovalProposal, type ApprovalState } from "@/features/trust";

import { appApi } from "./backend";
import { NextOptions, RunningExecution, VerifyingExecution } from "./booking-progress";
import { useSendText } from "./send-text";

// The fixed approval card inside the assistant-ui thread. The tool result only says which
// proposal to show; the card renders from GET /proposals/:id (terms, live status, fingerprint), so
// every card for the same proposal shows the same state. Approve posts the card's fingerprint to
// the approve route, the only place a grant is made, and only then tells the agent to go ahead.

const SERVICE_LABELS: Readonly<Record<ProposalCard["terms"]["service"], string>> = {
  plumber: "Plumber visit",
  electrician: "Electrician visit",
  ac_servicing: "AC servicing",
  carpenter: "Carpenter visit",
  cleaner: "Cleaning",
};

const slotFormat = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

const clockFormat = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

function slotLabel(start: string): string {
  return `${slotFormat.format(new Date(start))} IST`;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/** A provider keeps one palette slot everywhere, derived from its id. */
function toneOf(providerId: string): MonogramTone {
  const sum = [...providerId].reduce((total, char) => total + char.charCodeAt(0), 0);
  return ((sum % 6) + 1) as MonogramTone;
}

// One live copy of each proposal, shared by every card that shows it.
const proposals = new Map<string, ProposalView>();
const listeners = new Set<() => void>();

async function refreshProposal(proposalId: string): Promise<void> {
  proposals.set(proposalId, await appApi.getProposal(proposalId));
  for (const listener of listeners) listener();
}

function useProposal(proposalId: string): ProposalView | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => proposals.get(proposalId),
    () => undefined,
  );
}

function holdLeftLabel(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} left`;
}

/** Counts the hold down from what the backend said when the proposal was read. */
function useHoldLeft(proposal: ProposalView | undefined): string | undefined {
  const [now, setNow] = useState(() => Date.now());
  const [readAt, setReadAt] = useState(() => Date.now());
  useEffect(() => setReadAt(Date.now()), [proposal]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  if (proposal === undefined) return undefined;
  return holdLeftLabel(Math.max(0, proposal.holdSecondsLeft - Math.floor((now - readAt) / 1_000)));
}

function changeOf(change: TermChangeView): ApprovalChange {
  switch (change.field) {
    case "price":
      return change;
    case "slot":
      return { field: "slot", from: slotLabel(change.from.start), to: slotLabel(change.to.start) };
    case "provider":
      return { field: "provider", from: change.from.providerName, to: change.to.providerName };
  }
}

/** When the card stops being approvable: the hold's expiry, or a cancel or reschedule card's own window. */
function deadlineOf(terms: ProposalCard["terms"]): string {
  return terms.action === "book" ? terms.holdExpiresAt : terms.expiresAt;
}

/** When the hold ran out: when core found it lapsed, if it did, else the hold's own expiry. */
function expiredAtOf(proposal: ProposalView): string {
  return clockFormat.format(new Date(proposal.invalidation?.at ?? deadlineOf(proposal.terms)));
}

function stateOf(proposal: ProposalView, busy: boolean, holdLeft: string | undefined): ApprovalState {
  if (busy) return { status: "approving" };
  switch (proposal.status) {
    case "pending":
      return proposal.holdSecondsLeft > 0 ? { status: "pending", holdLeft } : { status: "expired", expiredAt: expiredAtOf(proposal) };
    case "declined":
      return { status: "declined" };
    case "expired":
      return { status: "expired", expiredAt: expiredAtOf(proposal) };
    case "voided": {
      const [first, ...rest] = (proposal.invalidation?.changes ?? []).map(changeOf);
      // A voided proposal always records what changed; without it, say so rather than show no change.
      return first === undefined ? { status: "expired", expiredAt: expiredAtOf(proposal) } : { status: "voided", changes: [first, ...rest] };
    }
    case "approved":
    case "executing":
    case "executed":
    case "verifying":
    case "failed":
      return { status: "approved" };
  }
}

function proposalOf(view: ProposalCard): ApprovalProposal {
  const { terms } = view;
  const service = SERVICE_LABELS[terms.service];
  switch (terms.action) {
    case "book":
      return {
        kind: "book",
        service,
        slot: slotLabel(terms.slot.start),
        price: terms.priceInr,
        address: `${terms.area}, Bengaluru`,
        cancellationTerms: terms.cancellationTerms,
      };
    case "cancel":
      return {
        kind: "cancel",
        service,
        slot: slotLabel(terms.slot.start),
        bookingId: terms.bookingId,
        fee: terms.priceInr,
        cancellationTerms: terms.cancellationTerms,
      };
    case "reschedule":
      return {
        kind: "reschedule",
        service,
        bookingId: terms.bookingId,
        fromSlot: slotLabel(terms.fromSlot.start),
        toSlot: slotLabel(terms.slot.start),
        price: terms.priceInr,
      };
  }
}

function cardElementId(proposalId: string): string {
  return `approval-card-${proposalId}`;
}

/** Brings the card that replaced a voided or expired one into view. */
function showCard(proposalId: string): void {
  document.getElementById(cardElementId(proposalId))?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function LiveApprovalCard({ card }: { readonly card: ProposalCard }) {
  const send = useSendText();
  const proposal = useProposal(card.proposalId);
  const running = useAuiState((state) => state.thread.isRunning);
  const holdLeft = useHoldLeft(proposal);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  // Read on mount and again whenever a turn ends, so the card follows the booking's progress.
  useEffect(() => {
    if (!running) void refreshProposal(card.proposalId).catch(() => setProblem("Can't read this proposal right now."));
  }, [card.proposalId, running]);

  const act = useCallback(
    async (call: () => Promise<unknown>, followUp: string) => {
      setBusy(true);
      setProblem(undefined);
      try {
        await call();
        await refreshProposal(card.proposalId);
        await send(followUp);
      } catch (error) {
        setProblem(error instanceof ApiRequestError ? error.message : "That didn't go through. Try again.");
        await refreshProposal(card.proposalId).catch(() => undefined);
      } finally {
        setBusy(false);
      }
    },
    [card.proposalId, send],
  );

  return (
    // Addressable, so a "Waiting on you" link can open the chat at this card and focus it.
    <div
      id={cardElementId(card.proposalId)}
      data-proposal-id={card.proposalId}
      tabIndex={-1}
      className="my-3 flex scroll-mt-16 flex-col gap-1.5 rounded-lg outline-none focus:outline-2 focus:outline-offset-4 focus:outline-ring"
    >
      {proposal === undefined ? (
        <div className="flex items-center gap-2 text-label text-fg-meta">
          <Spinner /> Loading the approval card…
        </div>
      ) : (
        <ApprovalCard
          proposal={proposalOf(proposal)}
          provider={{
            name: proposal.terms.providerName,
            initials: initialsOf(proposal.terms.providerName),
            tone: toneOf(proposal.terms.providerId),
            rating: proposal.terms.rating,
          }}
          state={stateOf(proposal, busy, holdLeft)}
          onApprove={() => void act(() => appApi.approveProposal(proposal.proposalId, { fingerprint: proposal.fingerprint }), CARD_FOLLOW_UPS.approved)}
          onDecline={() => void act(() => appApi.declineProposal(proposal.proposalId), CARD_FOLLOW_UPS.declined)}
          onOtherOptions={() =>
            // A replaced card's hold belongs to the card that replaced it, so that is the one to decline.
            void act(() => appApi.declineProposal(proposal.invalidation?.replacedBy ?? proposal.proposalId), CARD_FOLLOW_UPS.otherOptions)
          }
          onReviewChange={() => proposal.invalidation !== null && showCard(proposal.invalidation.replacedBy)}
          onCheckAgain={() => (proposal.invalidation === null ? void send("Please hold that slot again.") : showCard(proposal.invalidation.replacedBy))}
        />
      )}
      {problem !== undefined && (
        <p role="alert" className="m-0 text-label text-err">
          {problem}
        </p>
      )}
    </div>
  );
}

/** The receipt for a cancel or reschedule card once execute_proposal settled it, or undefined for anything else. */
function changeReceiptOf(output: ExecuteProposalOutput): ReactNode {
  const terms = output.proposal?.terms;
  if (terms === undefined || terms.action === "book") return undefined;
  const fromSlot = terms.action === "cancel" ? terms.slot : terms.fromSlot;
  const booking = { bookingId: terms.bookingId, provider: terms.providerName, slot: slotLabel(fromSlot.start) };
  switch (output.kind) {
    case "cancelled":
      return <ChangeReceipt booking={booking} state={{ status: "cancelled", fee: terms.priceInr }} />;
    case "rescheduled":
      return <ChangeReceipt booking={booking} state={{ status: "moved", toSlot: slotLabel(terms.slot.start) }} />;
    case "change_verifying":
      return <ChangeReceipt booking={booking} state={{ status: "checking", action: terms.action }} />;
    case "change_failed":
    case "booking_unavailable":
    case "reschedule_conflict":
      return <ChangeReceipt booking={booking} state={{ status: "failed", action: terms.action, reason: output.message }} />;
    default:
      return undefined;
  }
}

/** propose_action: the card for the proposal core made from the hold. */
export const ProposalCardPart: ToolCallMessagePartComponent = ({ result }) => {
  const parsed = ProposeActionOutputSchema.safeParse(result);
  if (result === undefined) {
    return (
      <div className="my-2 flex items-center gap-2 text-label text-fg-meta">
        <Spinner /> Preparing the approval card…
      </div>
    );
  }
  if (!parsed.success || parsed.data.kind !== "proposed") return null;
  return <LiveApprovalCard card={parsed.data.proposal} />;
};

function receiptOf(output: ExecuteProposalOutput) {
  const terms = output.proposal?.terms;
  if (terms === undefined) return undefined;
  return { provider: terms.providerName, slot: slotLabel(terms.slot.start), price: terms.priceInr };
}

/**
 * execute_proposal: the receipt once the world verified the booking, "Checking with the provider…"
 * while it can't tell yet (until the ledger settles it), the same approval card again when nobody
 * tapped Approve, and the voided (or expired) card with a fresh one under it when the provider
 * changed the terms or the hold ran out.
 */
export const ExecutionPart: ToolCallMessagePartComponent = ({ result }) => {
  const parsed = ExecuteProposalOutputSchema.safeParse(result);
  if (result === undefined || !parsed.success) return <RunningExecution />;
  const output = parsed.data;
  const booking = receiptOf(output);
  if (output.kind === "not_approved" && output.proposal !== null) return <LiveApprovalCard card={output.proposal} />;
  const change = changeReceiptOf(output);
  if (change !== undefined) {
    // A refused move: nothing moved, and under it the fresh card for the closest free time.
    return (
      <div className="my-3 flex flex-col gap-3">
        {change}
        {output.kind === "reschedule_conflict" && output.freshProposal !== null && <LiveApprovalCard card={output.freshProposal} />}
      </div>
    );
  }
  if (output.freshProposal !== null && output.proposal !== null) {
    // The terms changed or the hold ran out: the old card (voided or expired, old value beside new)
    // and right under it the fresh card, which needs its own tap.
    return (
      <>
        <LiveApprovalCard card={output.proposal} />
        <LiveApprovalCard card={output.freshProposal} />
      </>
    );
  }
  if (booking !== undefined && output.bookingId !== null && (output.kind === "booked" || output.kind === "already_booked")) {
    return (
      <div className="my-3">
        <BookingReceipt booking={booking} state={{ status: "booked", bookingId: output.bookingId }} />
      </div>
    );
  }
  if (booking !== undefined && output.kind === "verifying") return <VerifyingExecution output={output} booking={booking} />;
  if (booking !== undefined && (output.kind === "slot_taken" || output.kind === "booking_failed")) {
    return (
      <div className="my-3 flex flex-col gap-3">
        <BookingReceipt booking={booking} state={{ status: "failed", reason: output.message }} />
        {output.options !== undefined && output.options.length > 0 && <NextOptions options={output.options} />}
      </div>
    );
  }
  return <p className="my-1 text-label text-fg-meta">{output.message}</p>;
};
