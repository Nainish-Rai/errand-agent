// The receipt for a change to a booking, as v3's ActionReceipt: what the provider's booking list now
// shows. Fixed, never generated. "Cancelled" and "Moved" appear only once the booking's status
// confirmed the change.
import type { ReactNode } from "react";

import { formatRupees } from "@/components/money";
import { Status } from "@/components/status";

import { ActionReceipt, initialsOf, RequestMedia } from "./trust-surface";

export type ChangedBooking = {
  readonly bookingId: string;
  readonly provider: string;
  /** The visit as it was booked. */
  readonly slot: string;
  /** The provider's thumbnail (ticket 22). Without it the receipt shows their initials. */
  readonly media?: ReactNode;
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

function Head({ booking, sentence, status }: { readonly booking: ChangedBooking; readonly sentence: string; readonly status: ReactNode }) {
  return (
    <>
      <RequestMedia media={booking.media} initials={initialsOf(booking.provider)} />
      <p className="m-0 min-w-0 flex-1 text-base text-fg">{sentence}</p>
      {status}
    </>
  );
}

function bookingIdOf(booking: ChangedBooking) {
  return <span className="font-mono">{booking.bookingId}</span>;
}

export function ChangeReceipt({ booking, state }: ChangeReceiptProps) {
  switch (state.status) {
    case "cancelled":
      return (
        <ActionReceipt
          label="Cancelled"
          state="cancelled"
          head={<Head booking={booking} sentence={`${booking.provider} visit cancelled.`} status={<Status state="done" label="Cancelled" />} />}
          lines={[
            { label: `Cancelled ${booking.slot}`, detail: bookingIdOf(booking) },
            { label: state.fee === 0 ? "No fee" : `Paid a ${formatRupees(state.fee)} fee` },
            { label: "Confirmed with the provider", detail: "verified" },
          ]}
        />
      );
    case "moved":
      return (
        <ActionReceipt
          label="Moved"
          state="moved"
          head={<Head booking={booking} sentence={`${booking.provider} now comes ${state.toSlot}.`} status={<Status state="done" label="Moved" />} />}
          lines={[
            {
              label: `Moved to ${state.toSlot}`,
              detail: (
                <>
                  <span className="sr-only">was </span>
                  <s>{booking.slot}</s>
                </>
              ),
            },
            { label: "Kept the same booking", detail: bookingIdOf(booking) },
            { label: "Confirmed with the provider", detail: "verified" },
          ]}
        />
      );
    case "checking":
      return (
        <ActionReceipt
          label="Checking the change"
          state="checking"
          busy
          head={
            <Head
              booking={booking}
              sentence={state.action === "cancel" ? `Cancelling ${booking.provider} visit.` : `Moving ${booking.provider} visit.`}
              status={<Status state="running" label="Checking with provider" />}
            />
          }
          lines={[{ label: state.action === "cancel" ? `Asked to cancel ${booking.slot}` : `Asked to move ${booking.slot}`, detail: bookingIdOf(booking) }]}
        />
      );
    case "failed":
      return (
        <ActionReceipt
          label="Not changed"
          state="failed"
          head={
            <Head
              booking={booking}
              sentence={`${booking.provider} still comes ${booking.slot}.`}
              status={<Status state="failed" label={state.action === "cancel" ? "Not cancelled" : "Not moved"} />}
            />
          }
          lines={[{ label: state.reason, failed: true, detail: bookingIdOf(booking) }]}
        />
      );
  }
}
