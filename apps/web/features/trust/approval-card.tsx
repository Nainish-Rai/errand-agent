// The approval card: the only place in the UI with an Approve button. It is fixed, never generated.
// Presentational: the proposal and its state come in as props, the user's choice goes out as callbacks.
// Approving is the caller's job (POST /proposals/:id/approve with the fingerprint), not this card's.
//
// It is v3's ApprovalRequest: the provider and what approving does, the money it moves, every material
// detail, then the footer. Approve is the one glowing primary; when the press lands the outcome
// cross-fades into the footer at the same height and takes focus. If the price, slot or provider
// changes first, the card goes stale: its warning line opens and the fresh card under it asks again.
import { CircleAlert, Info, Pencil } from "lucide-react";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";

import { formatRupees, Money } from "@/components/money";
import type { MonogramTone } from "@/components/monogram";
import { Status } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import { AmountChip, CardNote, Details, RequestCard, RequestFooter, RequestMedia, type Detail } from "./trust-surface";

export type ApprovalProvider = {
  readonly name: string;
  readonly initials: string;
  readonly tone?: MonogramTone;
  /** Shown as "rated 4.7" when known. */
  readonly rating?: number;
  /** The provider's thumbnail (ticket 22). Without it the card shows their initials. */
  readonly media?: ReactNode;
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
  /**
   * Whether this card holds the view's one lime action. A second copy of a card already on screen (the
   * agent showed it again) is `quiet`: its Approve works the same but does not glow.
   */
  readonly emphasis?: "lead" | "quiet";
  readonly onApprove?: () => void;
  readonly onOtherOptions?: () => void;
  readonly onDecline?: () => void;
  /** Voided: open the proposal again with the new terms. */
  readonly onReviewChange?: () => void;
  /** Expired: ask the agent to hold the slot again. */
  readonly onCheckAgain?: () => void;
};

/** The card's accessible name, which the verification suites and the "Waiting on you" link find it by. */
const titles = { book: "Approve booking", cancel: "Approve cancellation", reschedule: "Approve reschedule" } as const;
const askAgain = {
  book: "If the provider, time or price changes, I'll ask again.",
  cancel: "If the booking or the fee changes, I'll ask again.",
  reschedule: "If the booking or the new time changes, I'll ask again.",
} as const;
const nothingDone = { book: "Nothing was booked.", cancel: "Nothing was cancelled.", reschedule: "Nothing was moved." } as const;
const released = { book: " The hold on the slot is released.", cancel: " Your booking stays as it is.", reschedule: " Your booking stays as it is." } as const;

/** The money this approval moves: the price, or the fee for a cancellation. */
export function approvalAmount(proposal: ApprovalProposal): number {
  return proposal.kind === "cancel" ? proposal.fee : proposal.price;
}

/** What the chip in the header shows: the charge approving makes. A move charges nothing new. */
function chargeOf(proposal: ApprovalProposal): number {
  return proposal.kind === "reschedule" ? 0 : approvalAmount(proposal);
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

/** What approving does, in the card's heading. */
function headingOf(proposal: ApprovalProposal, provider: ApprovalProvider): string {
  switch (proposal.kind) {
    case "book":
      return `Book ${provider.name}`;
    case "cancel":
      return `Cancel ${provider.name} visit`;
    case "reschedule":
      return `Move ${provider.name} visit`;
  }
}

/** The one line under the heading: the job, and what the provider's record says. */
function reasonOf(proposal: ApprovalProposal, provider: ApprovalProvider): string {
  const rated = provider.rating === undefined ? "" : `, rated ${provider.rating}`;
  if (proposal.kind === "cancel") return proposal.fee === 0 ? "Inside the free window, so no fee" : "Past the free window, so a fee applies";
  if (proposal.kind === "reschedule") return "Same booking, a new time";
  return `${proposal.service}${rated}`;
}

/** What the person approved, for the approved card's note. */
function approvedWhat(proposal: ApprovalProposal): string {
  const what = { book: formatRupees(approvalAmount(proposal)), cancel: "the cancellation", reschedule: "the move" } as const;
  return what[proposal.kind];
}

/** The buttons besides Approve: a booking offers other options; a change offers to keep the booking as it is. */
const otherOptionsLabel = { book: "Other options", cancel: undefined, reschedule: "Other times" } as const;
const declineLabel = { book: "Decline", cancel: "Keep booking", reschedule: "Keep current time" } as const;

function detailRows(proposal: ApprovalProposal, provider: ApprovalProvider, holdLeft: string | undefined): Detail[] {
  const rows: Detail[] = [{ label: "Provider", value: provider.rating === undefined ? provider.name : `${provider.name}, ${provider.rating} rating` }];
  switch (proposal.kind) {
    case "book":
      rows.push({ label: "Job", value: proposal.service }, { label: "When", value: proposal.slot });
      if (proposal.address !== undefined) rows.push({ label: "Where", value: proposal.address });
      rows.push({
        label: "Price",
        value: (
          <>
            <Money amount={proposal.price} />
            {proposal.priceNote !== undefined && <span className="text-xs text-fg-3">{proposal.priceNote}</span>}
          </>
        ),
      });
      if (proposal.cancellationTerms !== undefined) rows.push({ label: "Cancellation", value: proposal.cancellationTerms });
      break;
    case "cancel":
      rows.push(
        { label: "Booking", value: proposal.bookingId, id: true },
        { label: "When", value: proposal.slot },
        { label: "Fee", value: proposal.fee === 0 ? "No fee" : <Money amount={proposal.fee} /> },
      );
      if (proposal.cancellationTerms !== undefined) rows.push({ label: "Terms", value: proposal.cancellationTerms });
      break;
    case "reschedule":
      if (proposal.bookingId !== undefined) rows.push({ label: "Booking", value: proposal.bookingId, id: true });
      rows.push(
        {
          label: "When",
          value: (
            <>
              {proposal.toSlot}
              <span className="sr-only">, was </span>
              <s className="text-fg-3">{proposal.fromSlot}</s>
            </>
          ),
        },
        { label: "Price", value: <>{formatRupees(proposal.price)}, unchanged</> },
      );
      break;
  }
  // A booking card lasts as long as its slot hold; a cancel or reschedule card holds nothing, it just expires.
  if (holdLeft !== undefined) rows.push({ label: proposal.kind === "book" ? "Hold" : "Valid", value: holdLeft });
  return rows;
}

const changeLabels = { price: "Price changed ", slot: "Time changed ", provider: "Provider changed " } as const;
const staleWords = { price: "Price changed", slot: "Slot changed", provider: "Provider changed" } as const;
const reviewLabels = { price: "Review new price", slot: "Review new time", provider: "Review new provider" } as const;

function ChangeLine({ change }: { readonly change: ApprovalChange }) {
  const [from, to] = change.field === "price" ? [formatRupees(change.from), formatRupees(change.to)] : [change.from, change.to];
  return (
    <>
      {changeLabels[change.field]}
      <s>{from}</s> <span aria-hidden>→</span>
      <span className="sr-only">to</span> <span className="font-medium">{to}</span>.{" "}
    </>
  );
}

/** Approve: the label keeps its place while the spinner fades in over it, so the button never changes size. */
function ApproveButton({ label, approving, lead, onClick }: { readonly label: string; readonly approving: boolean; readonly lead: boolean; readonly onClick?: () => void }) {
  return (
    <Button variant={lead ? "primary" : "secondary"} className="min-w-0 flex-1" aria-busy={approving || undefined} disabled={approving} onClick={onClick}>
      <span className="grid min-w-0 place-items-center [grid-template-areas:'stack']">
        <span aria-hidden={approving || undefined} className={approving ? "opacity-0 transition-opacity duration-(--dur-fast) [grid-area:stack]" : "transition-opacity duration-(--dur-fast) [grid-area:stack]"}>
          {label}
        </span>
        <span aria-hidden className={approving ? "inline-flex items-center gap-1.5 opacity-100 transition-opacity duration-(--dur-fast) [grid-area:stack]" : "inline-flex items-center gap-1.5 opacity-0 transition-opacity duration-(--dur-fast) [grid-area:stack]"}>
          <Spinner role={undefined} aria-label={undefined} className="size-3 border-current border-r-transparent" />
          {label}
        </span>
        {approving && <span className="sr-only">Approving…</span>}
      </span>
    </Button>
  );
}

/** The outcome of a press takes focus once it replaces the buttons, so a keyboard user hears it. */
function useFocusOutcome(outcome: string, pressed: RefObject<boolean>) {
  const footer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pressed.current) return;
    const status = footer.current?.querySelector<HTMLElement>('[data-slot="status"]');
    if (status === null || status === undefined) return;
    status.focus();
    pressed.current = false;
  }, [outcome, pressed]);
  return footer;
}

export function ApprovalCard(props: ApprovalCardProps) {
  const { proposal, provider, state, emphasis = "lead" } = props;
  const pressed = useRef(false);
  const footer = useFocusOutcome(state.status, pressed);
  const press = (action: (() => void) | undefined) => () => {
    pressed.current = true;
    action?.();
  };
  const settled = state.status !== "pending" && state.status !== "approving";
  const holdLeft = state.status === "pending" ? state.holdLeft : undefined;

  return (
    <RequestCard label={titles[proposal.kind]} state={state.status} busy={state.status === "approving"}>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <RequestMedia media={provider.media} initials={provider.initials} />
            <p className="m-0 min-w-0 truncate font-medium">{headingOf(proposal, provider)}</p>
          </div>
          <AmountChip amount={chargeOf(proposal)} />
        </div>
        <p className="m-0 truncate text-sm text-fg-2">{reasonOf(proposal, provider)}</p>
        {state.status === "voided" && (
          <CardNote tone="warn" icon={<CircleAlert />}>
            {state.changes.map((change) => (
              <ChangeLine key={change.field} change={change} />
            ))}
            {nothingDone[proposal.kind]}
          </CardNote>
        )}
        {state.status === "declined" && (
          <CardNote tone="info" icon={<Info />}>
            You declined. {nothingDone[proposal.kind]}
            {released[proposal.kind]}
          </CardNote>
        )}
        {state.status === "expired" && (
          <CardNote tone="info" icon={<Info />}>
            The hold expired at <span className="tabular-nums">{state.expiredAt}</span>. {nothingDone[proposal.kind]}
          </CardNote>
        )}
      </div>
      <Details faded={settled && state.status !== "approved"} rows={detailRows(proposal, provider, holdLeft)} />
      {state.status === "pending" && <p className="m-0 text-xs text-fg-3">{askAgain[proposal.kind]}</p>}
      {state.status === "approved" && (
        <p className="m-0 animate-fade text-sm text-fg-2">You approved {approvedWhat(proposal)}. I&apos;m confirming it with the provider now.</p>
      )}
      <div ref={footer}>
        <RequestFooter outcome={state.status === "approving" ? "pending" : state.status}>
          {(state.status === "pending" || state.status === "approving") && (
            <>
              <ApproveButton label={approveLabel(proposal)} approving={state.status === "approving"} lead={emphasis === "lead"} onClick={press(props.onApprove)} />
              {otherOptionsLabel[proposal.kind] !== undefined && (
                <Button variant="secondary" size="icon" aria-label={otherOptionsLabel[proposal.kind]} disabled={state.status === "approving"} onClick={props.onOtherOptions}>
                  <Pencil />
                </Button>
              )}
              <Button variant="ghost" disabled={state.status === "approving"} onClick={press(props.onDecline)}>
                {declineLabel[proposal.kind]}
              </Button>
            </>
          )}
          {state.status === "approved" && <Status state="done" label="Approved" focusable />}
          {state.status === "declined" && <Status state="canceled" label="Declined" focusable />}
          {state.status === "voided" && (
            <>
              <Status state="canceled" label={`${staleWords[state.changes[0].field]}, voided`} focusable className="mr-auto" />
              <Button variant="secondary" onClick={props.onReviewChange}>
                {reviewLabels[state.changes[0].field]}
              </Button>
              <Button variant="ghost" onClick={props.onOtherOptions}>
                Other options
              </Button>
            </>
          )}
          {state.status === "expired" && (
            <>
              <Status state="canceled" label="Expired" focusable className="mr-auto" />
              <Button variant="secondary" onClick={props.onCheckAgain}>
                Check again
              </Button>
              <Button variant="ghost" onClick={props.onOtherOptions}>
                Other options
              </Button>
            </>
          )}
        </RequestFooter>
      </div>
    </RequestCard>
  );
}
