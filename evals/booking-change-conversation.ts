import type { BookingView, ModelScriptTurn, ProposalCard } from "@errand/contracts";

// The scripted model's side of changing a booking the person already has, shared by the
// booking-change scenarios. The world is seeded with seed 42 on the evals' pinned clock (Wednesday
// 2026-11-04, 09:00 IST): the person has an AC service with Ravi Aircon Experts booked for Monday
// 9 Nov at 11:00 (bkg_seed_3, ₹999, free to cancel up to 4 hours before), and their last
// electrician was Lakshmi Wiring Services in Koramangala (bkg_seed_1, 24 days ago).

export const AC_BOOKING = {
  bookingId: "bkg_seed_3",
  providerId: "prv_ac_servicing_koramangala_1",
  slot: {
    start: "2026-11-09T11:00:00+05:30",
    end: "2026-11-09T12:00:00+05:30",
  },
  priceInr: 999,
} as const;

export const SATURDAY = { from: "2026-11-07", to: "2026-11-07" } as const;

/** Ravi Aircon Experts' free slots on Saturday 7 Nov. */
export const SATURDAY_SLOTS = {
  at8: { start: "2026-11-07T08:00:00+05:30", end: "2026-11-07T09:00:00+05:30" },
  at14: {
    start: "2026-11-07T14:00:00+05:30",
    end: "2026-11-07T15:00:00+05:30",
  },
} as const;

export const LAST_ELECTRICIAN = {
  bookingId: "bkg_seed_1",
  providerId: "prv_electrician_koramangala_1",
} as const;

/** Find the AC booking and Ravi Aircon Experts' free times on Saturday. */
export const FIND_SATURDAY_STEPS: ModelScriptTurn["steps"] = [
  { toolCalls: [{ name: "list_bookings", input: {} }] },
  {
    toolCalls: [
      {
        name: "find_reschedule_slots",
        input: { booking_id: AC_BOOKING.bookingId, ...SATURDAY },
      },
    ],
  },
];

/** Put the move of the AC booking to `slot` on a card. */
export function proposeMoveTurn(slot: { readonly start: string; readonly end: string }, reply: string): ModelScriptTurn {
  return {
    steps: [
      {
        toolCalls: [
          {
            name: "propose_action",
            input: {
              action: "reschedule",
              booking_id: AC_BOOKING.bookingId,
              slot,
            },
          },
        ],
      },
      { text: reply },
    ],
  };
}

/** The AC booking as the world shows it now. */
export async function acBookingNow(api: { listBookings(): Promise<readonly BookingView[]> }): Promise<BookingView | undefined> {
  return (await api.listBookings()).find((booking) => booking.bookingId === AC_BOOKING.bookingId);
}

/** The slot a reschedule card moves to and from, or undefined for any other card. */
export function moveOf(card: ProposalCard | undefined): { readonly from: string; readonly to: string } | undefined {
  return card?.terms.action === "reschedule" ? { from: card.terms.fromSlot.start, to: card.terms.slot.start } : undefined;
}
