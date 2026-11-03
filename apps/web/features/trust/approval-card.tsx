// The approval card: the only place in the UI with an Approve button. It is fixed, never generated.
// Presentational: the proposal and its state come in as props, the user's choice goes out as callbacks.
// Approving is the caller's job (POST /proposals/:id/approve with the fingerprint), not this card's.
import type { ReactNode } from "react";

import { formatRupees, Money } from "@/components/money";
import { Monogram, type MonogramTone } from "@/components/monogram";
import { StatusMark } from "@/components/status-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { DetailTable, Notice, TrustActions, TrustCard, TrustHeader, TrustNote, type DetailRow } from "./trust-surface";

export type ApprovalProvider = {
  readonly name: string;
  readonly initials: string;
  readonly tone?: MonogramTone;
  /** Shown as "★ 4.7" when known. */
  readonly rating?: number;
};

/** What approving commits to. The amount on the button is the money this approval moves. */
export type ApprovalProposal =
  | {
      readonly kind: "book";
      readonly service: string;
      readonly slot: string;
      readonly price: number;
      readonly priceNote?: string;
      /** Where the visit happens. */
      readonly address?: string;
      /** The provider's own cancellation terms. */
      readonly cancellationTerms?: string;
    }
  | {
      readonly kind: "cancel";
      readonly service: string;
      readonly slot: string;
      readonly bookingId: string;
      /** What cancelling costs now, by the provider's rule; 0 inside the free window. */
      readonly fee: number;
      /** The provider's own cancellation terms the fee comes from. */
      readonly cancellationTerms?: string;
    }
  | {
      readonly kind: "reschedule";
      readonly service: string;
      readonly bookingId?: string;
      readonly fromSlot: string;
      readonly toSlot: string;
      /** The price of the booking at the new time. */
      readonly price: number;
    };

/** What changed since the user saw the proposal. Any change voids it; nothing is committed. */
export type ApprovalChange =
  | { readonly field: "price"; readonly from: number; readonly to: number }
  | { readonly field: "slot"; readonly from: string; readonly to: string }
  | { readonly field: "provider"; readonly from: string; readonly to: string };

export type ApprovalState =
  | { readonly status: "pending"; /** e.g. "8:42 left" on the slot hold. */ readonly holdLeft?: string }
  | { readonly status: "approving" }
  | { readonly status: "approved" }
  /** Every term that changed, old value beside new; at least one. */
  | { readonly status: "voided"; readonly changes: readonly [ApprovalChange, ...ApprovalChange[]] }
  | { readonly status: "expired"; /** e.g. "09:12". */ readonly expiredAt: string }
  /** The person declined (or asked for other options); the hold was released. */
  | { readonly status: "declined" };

export type ApprovalCardProps = {
  readonly proposal: ApprovalProposal;
  readonly provider: ApprovalProvider;
  readonly state: ApprovalState;
  readonly onApprove?: () => void;
  readonly onOtherOptions?: () => void;
  readonly onDecline?: () => void;
  /** Voided: open the proposal again with the new terms. */
  readonly onReviewChange?: () => void;
  /** Expired: ask the agent to hold the slot again. */
  readonly onCheckAgain?: () => void;
};

const titles = { book: "Approve booking", cancel: "Approve cancellation", reschedule: "Approve reschedule" } as const;
const commitment = {
  book: "Approving books exactly this.",
  cancel: "Approving cancels exactly this booking.",
  reschedule: "Approving moves exactly this booking.",
} as const;
const askAgain = {
  book: "If the provider, time or price changes, I'll ask again.",
  cancel: "If the booking or the fee changes, I'll ask again.",
  reschedule: "If the booking or the new time changes, I'll ask again.",
} as const;
const nothingDone = { book: "Nothing was booked.", cancel: "Nothing was cancelled.", reschedule: "Nothing was moved." } as const;

/** The money this approval moves: the price, or the fee for a cancellation. */
export function approvalAmount(proposal: ApprovalProposal): number {
  return proposal.kind === "cancel" ? proposal.fee : proposal.price;
}

/**
 * "Approve ₹899" for a booking, the money it moves. A cancellation shows its fee, or says it is
 * free; a move charges nothing new, so its button names the move, not the visit's price.
 */
export function approveLabel(proposal: ApprovalProposal): string {
  if (proposal.kind === "book") return `Approve ${formatRupees(approvalAmount(proposal))}`;
  if (proposal.kind === "reschedule") return "Approve move";
  return proposal.fee === 0 ? "Approve free cancellation" : `Approve ${formatRupees(proposal.fee)}`;
}

/** What the person approved, for the approved card's note. */
function approvedWhat(proposal: ApprovalProposal): string {
  const what = { book: formatRupees(approvalAmount(proposal)), cancel: "the cancellation", reschedule: "the move" } as const;
  return what[proposal.kind];
}

/** The buttons besides Approve: a booking offers other options; a change offers to keep the booking as it is. */
const otherOptionsLabel = { book: "Other options", cancel: undefined, reschedule: "Other times" } as const;
const declineLabel = { book: "Decline", cancel: "Keep booking", reschedule: "Keep current time" } as const;

function providerValue(provider: ApprovalProvider): ReactNode {
  return (
    <>
      <Monogram initials={provider.initials} tone={provider.tone} />
      {provider.name}
      {provider.rating !== undefined && <span className="font-mono text-xs text-fg-3">★ {provider.rating}</span>}
    </>
  );
}

function detailRows(proposal: ApprovalProposal, provider: ApprovalProvider, holdLeft: string | undefined): DetailRow[] {
  const rows: DetailRow[] = [
    { label: "Provider", value: providerValue(provider) },
    { label: "Job", value: proposal.service },
  ];
  switch (proposal.kind) {
    case "book":
      rows.push(
        { label: "When", value: proposal.slot, mono: true },
        {
          label: "Price",
          value: (
            <>
              <Money amount={proposal.price} />
              {proposal.priceNote !== undefined && <span className="font-mono text-xs text-fg-3">{proposal.priceNote}</span>}
            </>
          ),
        },
      );
      if (proposal.address !== undefined) rows.push({ label: "Where", value: proposal.address });
      if (proposal.cancellationTerms !== undefined) rows.push({ label: "Cancel", value: proposal.cancellationTerms });
      break;
    case "cancel":
      rows.push(
        { label: "Booking", value: proposal.bookingId, mono: true },
        { label: "When", value: proposal.slot, mono: true },
        { label: "Fee", value: proposal.fee === 0 ? "No fee" : <Money amount={proposal.fee} /> },
      );
      if (proposal.cancellationTerms !== undefined) rows.push({ label: "Terms", value: proposal.cancellationTerms });
      break;
    case "reschedule":
      if (proposal.bookingId !== undefined) rows.push({ label: "Booking", value: proposal.bookingId, mono: true });
      rows.push(
        {
          label: "When",
          value: (
            <>
              <s className="text-fg-3">{proposal.fromSlot}</s>
              <span aria-hidden>→</span>
              <span className="sr-only">moves to</span>
              {proposal.toSlot}
            </>
          ),
          mono: true,
        },
        { label: "Price", value: <Money amount={proposal.price} /> },
      );
      break;
  }
  // A booking card lasts as long as its slot hold; a cancel or reschedule card holds nothing, it just expires.
  if (holdLeft !== undefined) rows.push({ label: proposal.kind === "book" ? "Hold" : "Valid", value: holdLeft, mono: true });
  return rows;
}

const changeLabels = { price: "Price changed ", slot: "Time changed ", provider: "Provider changed " } as const;
const reviewLabels = { price: "Review new price", slot: "Review new time", provider: "Review new provider" } as const;

function ChangeLine({ change }: { readonly change: ApprovalChange }) {
  const [from, to] = change.field === "price" ? [formatRupees(change.from), formatRupees(change.to)] : [change.from, change.to];
  return (
    <>
      {changeLabels[change.field]}
      <s className="font-mono text-fg-3">{from}</s> <span aria-hidden>→</span>
      <span className="sr-only">to</span> <span className="font-mono">{to}</span>.{" "}
    </>
  );
}

export function ApprovalCard(props: ApprovalCardProps) {
  const { proposal, provider, state } = props;
  const title = titles[proposal.kind];

  switch (state.status) {
    case "pending":
    case "approving": {
      const approving = state.status === "approving";
      return (
        <TrustCard label={title} busy={approving}>
          <TrustHeader
            title={title}
            status={approving ? <StatusMark kind="checking" label="Approving" /> : <StatusMark kind="needs-you" label="Needs you" />}
          />
          <DetailTable rows={detailRows(proposal, provider, state.status === "pending" ? state.holdLeft : undefined)} />
          <TrustNote>
            {commitment[proposal.kind]} {askAgain[proposal.kind]}
          </TrustNote>
          <TrustActions>
            <Button variant="primary" loading={approving} onClick={props.onApprove}>
              {approving ? "Approving…" : approveLabel(proposal)}
            </Button>
            {otherOptionsLabel[proposal.kind] !== undefined && (
              <Button variant="secondary" disabled={approving} onClick={props.onOtherOptions}>
                {otherOptionsLabel[proposal.kind]}
              </Button>
            )}
            <Button variant="ghost" disabled={approving} onClick={props.onDecline}>
              {declineLabel[proposal.kind]}
            </Button>
          </TrustActions>
        </TrustCard>
      );
    }
    case "approved":
      return (
        <TrustCard label={title}>
          <TrustHeader title={title} status={<StatusMark kind="ok" label="Approved" />} />
          <DetailTable rows={detailRows(proposal, provider, undefined)} />
          <TrustNote>You approved {approvedWhat(proposal)}. I&apos;m confirming it with the provider now.</TrustNote>
        </TrustCard>
      );
    case "voided":
      return (
        <TrustCard label={title} tone="voided">
          <TrustHeader title={title} status={<Badge variant="tag">voided</Badge>} />
          <Notice tone="err" lead={<span aria-hidden className="text-danger-text">✕</span>}>
            {state.changes.map((change) => (
              <ChangeLine key={change.field} change={change} />
            ))}
            {nothingDone[proposal.kind]}
          </Notice>
          <DetailTable faded rows={detailRows(proposal, provider, undefined)} />
          <TrustActions>
            <Button variant="primary" onClick={props.onReviewChange}>
              {reviewLabels[state.changes[0].field]}
            </Button>
            <Button variant="secondary" onClick={props.onOtherOptions}>
              Other options
            </Button>
          </TrustActions>
        </TrustCard>
      );
    case "declined":
      return (
        <TrustCard label={title}>
          <TrustHeader title={title} status={<StatusMark kind="cancelled" label="Declined" />} />
          <Notice tone="info" lead={<span aria-hidden className="text-fg-3">✕</span>}>
            You declined. {nothingDone[proposal.kind]}
          </Notice>
          <DetailTable faded rows={detailRows(proposal, provider, undefined)} />
        </TrustCard>
      );
    case "expired":
      return (
        <TrustCard label={title}>
          <TrustHeader title={title} status={<StatusMark kind="expired" label="Expired" />} />
          <Notice tone="info" lead={<span aria-hidden className="text-fg-3">◷</span>}>
            The hold expired at <span className="font-mono">{state.expiredAt}</span>. {nothingDone[proposal.kind]}
          </Notice>
          <DetailTable faded rows={detailRows(proposal, provider, undefined)} />
          <TrustActions>
            <Button variant="secondary" onClick={props.onCheckAgain}>
              Check again
            </Button>
            <Button variant="ghost" onClick={props.onOtherOptions}>
              Other options
            </Button>
          </TrustActions>
        </TrustCard>
      );
  }
}
