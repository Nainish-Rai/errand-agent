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
  | { readonly kind: "cancel"; readonly service: string; readonly slot: string; readonly bookingId: string; readonly fee: number }
  | {
      readonly kind: "reschedule";
      readonly service: string;
      readonly fromSlot: string;
      readonly toSlot: string;
      /** The price of the booking at the new time. */
      readonly price: number;
    };

/** What changed since the user saw the proposal. Any change voids it; nothing is committed. */
export type ApprovalChange =
  | { readonly field: "price"; readonly from: number; readonly to: number }
  | { readonly field: "slot"; readonly from: string; readonly to: string };

export type ApprovalState =
  | { readonly status: "pending"; /** e.g. "8:42 left" on the slot hold. */ readonly holdLeft?: string }
  | { readonly status: "approving" }
  | { readonly status: "approved" }
  | { readonly status: "voided"; readonly change: ApprovalChange }
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
const nothingDone = { book: "Nothing was booked.", cancel: "Nothing was cancelled.", reschedule: "Nothing was moved." } as const;

/** The money this approval moves: the price, or the fee for a cancellation. */
export function approvalAmount(proposal: ApprovalProposal): number {
  return proposal.kind === "cancel" ? proposal.fee : proposal.price;
}

/** "Approve ₹899". */
export function approveLabel(proposal: ApprovalProposal): string {
  return `Approve ${formatRupees(approvalAmount(proposal))}`;
}

function providerValue(provider: ApprovalProvider): ReactNode {
  return (
    <>
      <Monogram initials={provider.initials} tone={provider.tone} />
      {provider.name}
      {provider.rating !== undefined && <span className="font-mono text-meta text-fg-meta">★ {provider.rating}</span>}
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
              {proposal.priceNote !== undefined && <span className="font-mono text-meta text-fg-meta">{proposal.priceNote}</span>}
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
        { label: "Fee", value: <Money amount={proposal.fee} /> },
      );
      break;
    case "reschedule":
      rows.push(
        {
          label: "When",
          value: (
            <>
              <s className="text-fg-meta">{proposal.fromSlot}</s>
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
  if (holdLeft !== undefined) rows.push({ label: "Hold", value: holdLeft, mono: true });
  return rows;
}

function ChangeLine({ change }: { readonly change: ApprovalChange }) {
  const [from, to] = change.field === "price" ? [formatRupees(change.from), formatRupees(change.to)] : [change.from, change.to];
  return (
    <>
      {change.field === "price" ? "Price changed " : "Time changed "}
      <s className="font-mono text-fg-meta">{from}</s> <span aria-hidden>→</span>
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
          <TrustNote>{commitment[proposal.kind]} If the provider, time or price changes, I&apos;ll ask again.</TrustNote>
          <TrustActions>
            <Button variant="primary" loading={approving} onClick={props.onApprove}>
              {approving ? "Approving…" : approveLabel(proposal)}
            </Button>
            <Button variant="secondary" disabled={approving} onClick={props.onOtherOptions}>
              Other options
            </Button>
            <Button variant="ghost" disabled={approving} onClick={props.onDecline}>
              Decline
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
          <TrustNote>You approved {formatRupees(approvalAmount(proposal))}. I&apos;m confirming it with the provider now.</TrustNote>
        </TrustCard>
      );
    case "voided":
      return (
        <TrustCard label={title} tone="voided">
          <TrustHeader title={title} status={<Badge variant="tag">voided</Badge>} />
          <Notice tone="err" lead={<span aria-hidden className="text-err">✕</span>}>
            <ChangeLine change={state.change} />
            {nothingDone[proposal.kind]}
          </Notice>
          <DetailTable faded rows={detailRows(proposal, provider, undefined)} />
          <TrustActions>
            <Button variant="primary" onClick={props.onReviewChange}>
              {state.change.field === "price" ? "Review new price" : "Review new time"}
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
          <Notice tone="info" lead={<span aria-hidden className="text-fg-meta">✕</span>}>
            You declined. {nothingDone[proposal.kind]}
          </Notice>
          <DetailTable faded rows={detailRows(proposal, provider, undefined)} />
        </TrustCard>
      );
    case "expired":
      return (
        <TrustCard label={title}>
          <TrustHeader title={title} status={<StatusMark kind="expired" label="Expired" />} />
          <Notice tone="info" lead={<span aria-hidden className="text-fg-meta">◷</span>}>
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
