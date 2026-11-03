// The booking receipt: what the provider confirmed. Fixed, never generated. A booking ID is shown
// only once the provider has verified it; until then the row says "checking…", never a blank.
import { Money } from "@/components/money";
import { StatusMark } from "@/components/status-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { DetailTable, Notice, TrustActions, TrustCard, TrustHeader } from "./trust-surface";

export type ReceiptBooking = {
  readonly provider: string;
  readonly slot: string;
  readonly price: number;
};

export type ReceiptState =
  | { readonly status: "booked"; readonly bookingId: string }
  | { readonly status: "checking" }
  | { readonly status: "failed"; /** One line, from the outcome presenter. */ readonly reason: string };

type BookingReceiptProps = {
  readonly booking: ReceiptBooking;
  readonly state: ReceiptState;
  /** Failed: show alternatives. */
  readonly onSeeOptions?: () => void;
};

export function BookingReceipt({ booking, state, onSeeOptions }: BookingReceiptProps) {
  const rows = (bookingId: string, priceLabel: string) => [
    { label: "Booking", value: bookingId, mono: true },
    { label: "Provider", value: booking.provider },
    { label: "When", value: booking.slot, mono: true },
    { label: priceLabel, value: <Money amount={booking.price} /> },
  ];

  switch (state.status) {
    case "booked":
      return (
        <TrustCard label="Booked">
          <TrustHeader lead={<span aria-hidden className="text-success-text">✓</span>} title="Booked" status={<Badge variant="verified">verified</Badge>} />
          <DetailTable rows={rows(state.bookingId, "Paid")} />
        </TrustCard>
      );
    case "checking":
      return (
        <TrustCard label="Booking" busy>
          <TrustHeader title="Booking" status={<StatusMark kind="checking" label="Checking" />} />
          <DetailTable rows={rows("checking…", "Price")} />
        </TrustCard>
      );
    case "failed":
      return (
        <TrustCard label="Not booked" tone="voided">
          <TrustHeader title="Not booked" status={<StatusMark kind="cancelled" label="Failed" />} />
          <Notice tone="err" lead={<span aria-hidden className="text-danger-text">✕</span>}>
            {state.reason} You were not charged.
          </Notice>
          <DetailTable faded rows={rows("not available", "Price")} />
          {onSeeOptions !== undefined && (
            <TrustActions>
              <Button variant="secondary" onClick={onSeeOptions}>
                See options
              </Button>
            </TrustActions>
          )}
        </TrustCard>
      );
  }
}
