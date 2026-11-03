// The receipt for a change to a booking: what the provider's booking list now shows. Fixed, never
// generated. "Cancelled" and "Moved" appear only once the booking's status confirmed the change.
import { Money } from "@/components/money";
import { StatusMark } from "@/components/status-mark";
import { Badge } from "@/components/ui/badge";

import { DetailTable, Notice, TrustCard, TrustHeader, type DetailRow } from "./trust-surface";

export type ChangedBooking = {
  readonly bookingId: string;
  readonly provider: string;
  /** The visit as it was booked. */
  readonly slot: string;
};

export type ChangeReceiptState =
  | { readonly status: "cancelled"; readonly fee: number }
  | { readonly status: "moved"; readonly toSlot: string }
  | { readonly status: "checking"; readonly action: "cancel" | "reschedule" }
  | { readonly status: "failed"; readonly action: "cancel" | "reschedule"; /** One line, from the outcome presenter. */ readonly reason: string };

type ChangeReceiptProps = {
  readonly booking: ChangedBooking;
  readonly state: ChangeReceiptState;
};

function baseRows(booking: ChangedBooking): DetailRow[] {
  return [
    { label: "Booking", value: booking.bookingId, mono: true },
    { label: "Provider", value: booking.provider },
  ];
}

export function ChangeReceipt({ booking, state }: ChangeReceiptProps) {
  switch (state.status) {
    case "cancelled":
      return (
        <TrustCard label="Cancelled">
          <TrustHeader lead={<span aria-hidden className="text-ok">✓</span>} title="Cancelled" status={<Badge variant="verified">verified</Badge>} />
          <DetailTable
            rows={[
              ...baseRows(booking),
              { label: "When", value: <s className="text-fg-meta">{booking.slot}</s>, mono: true },
              { label: "Fee", value: state.fee === 0 ? "No fee" : <Money amount={state.fee} /> },
            ]}
          />
        </TrustCard>
      );
    case "moved":
      return (
        <TrustCard label="Moved">
          <TrustHeader lead={<span aria-hidden className="text-ok">✓</span>} title="Moved" status={<Badge variant="verified">verified</Badge>} />
          <DetailTable
            rows={[
              ...baseRows(booking),
              {
                label: "When",
                value: (
                  <>
                    <s className="text-fg-meta">{booking.slot}</s>
                    <span aria-hidden>→</span>
                    <span className="sr-only">moved to</span>
                    {state.toSlot}
                  </>
                ),
                mono: true,
              },
            ]}
          />
        </TrustCard>
      );
    case "checking":
      return (
        <TrustCard label="Checking the change" busy>
          <TrustHeader title={state.action === "cancel" ? "Cancelling" : "Moving"} status={<StatusMark kind="checking" label="Checking" />} />
          <DetailTable rows={[...baseRows(booking), { label: "When", value: booking.slot, mono: true }]} />
        </TrustCard>
      );
    case "failed":
      return (
        <TrustCard label="Not changed" tone="voided">
          <TrustHeader title={state.action === "cancel" ? "Not cancelled" : "Not moved"} status={<StatusMark kind="cancelled" label="Failed" />} />
          <Notice tone="err" lead={<span aria-hidden className="text-err">✕</span>}>
            {state.reason}
          </Notice>
          <DetailTable faded rows={[...baseRows(booking), { label: "When", value: booking.slot, mono: true }]} />
        </TrustCard>
      );
  }
}
