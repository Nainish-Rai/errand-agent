// The booking receipt: what the provider confirmed, as v3's ActionReceipt. Fixed, never generated.
// "Booked" appears only once the provider has verified the booking ID, on the solid booked mark. A
// booking cannot be undone, so there is no Undo: the receipt says so and offers Reschedule and Cancel
// booking, which each lead to a fresh approval.
import { Clock, X } from "lucide-react";
import type { ReactNode } from "react";

import { formatRupees } from "@/components/money";
import { Status } from "@/components/status";
import { Button } from "@/components/ui/button";

import { ActionReceipt, initialsOf, RequestMedia } from "./trust-surface";

export type ReceiptBooking = {
  readonly provider: string;
  readonly slot: string;
  readonly price: number;
  /** The provider's thumbnail (ticket 22). Without it the receipt shows their initials. */
  readonly media?: ReactNode;
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
  /** Booked: ask for a new time, which leads to a fresh approval. */
  readonly onReschedule?: () => void;
  /** Booked: ask to cancel, which leads to a fresh approval. */
  readonly onCancelBooking?: () => void;
};

function Head({ booking, sentence, status }: { readonly booking: ReceiptBooking; readonly sentence: string; readonly status: ReactNode }) {
  return (
    <>
      <RequestMedia media={booking.media} initials={initialsOf(booking.provider)} />
      <p className="m-0 min-w-0 flex-1 text-base text-fg">{sentence}</p>
      {status}
    </>
  );
}

export function BookingReceipt({ booking, state, onSeeOptions, onReschedule, onCancelBooking }: BookingReceiptProps) {
  switch (state.status) {
    case "booked":
      return (
        <ActionReceipt
          label="Booked"
          state="booked"
          head={<Head booking={booking} sentence={`${booking.provider} comes ${booking.slot}.`} status={<Status state="done" label="Booked" booked />} />}
          lines={[
            { label: `Booked ${booking.provider} for ${formatRupees(booking.price)}`, detail: <span className="font-mono">{state.bookingId}</span> },
            { label: `Held ${booking.slot}` },
            { label: "Confirmed with the provider", detail: "verified" },
          ]}
          note="A booking cannot be undone. You can reschedule it or cancel it, and I'll ask you to approve either first."
          actions={
            onReschedule === undefined && onCancelBooking === undefined ? undefined : (
              <>
                {onReschedule !== undefined && (
                  <Button size="sm" variant="ghost" onClick={onReschedule}>
                    <Clock />
                    Reschedule
                  </Button>
                )}
                {onCancelBooking !== undefined && (
                  <Button size="sm" variant="ghost" onClick={onCancelBooking}>
                    <X />
                    Cancel booking
                  </Button>
                )}
              </>
            )
          }
        />
      );
    case "checking":
      return (
        <ActionReceipt
          label="Booking"
          state="checking"
          busy
          head={<Head booking={booking} sentence={`Booking ${booking.provider} for ${booking.slot}.`} status={<Status state="running" label="Checking with provider" />} />}
          lines={[{ label: `Held ${booking.slot}` }]}
          note="The booking ID shows here once the provider confirms it."
        />
      );
    case "failed":
      return (
        <ActionReceipt
          label="Not booked"
          state="failed"
          head={<Head booking={booking} sentence={`${booking.provider} was not booked.`} status={<Status state="failed" label="Not booked" />} />}
          lines={[{ label: state.reason, failed: true }]}
          note="You were not charged."
          actions={
            onSeeOptions === undefined ? undefined : (
              <Button size="sm" variant="ghost" onClick={onSeeOptions}>
                See options
              </Button>
            )
          }
        />
      );
  }
}
