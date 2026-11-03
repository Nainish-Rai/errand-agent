import type { BookingSummary, FindRescheduleSlotsOutput, ListBookingsOutput } from "@errand/contracts";

import type { Booking } from "../../src/core/ports/provider-world";
import type { FindRescheduleSlotsOutcome } from "../../src/core/use-cases/find-reschedule-slots";
import type { BookingHistory, BookingRecord } from "../../src/core/use-cases/list-bookings";

// The person's bookings and a booking's free slots, as the list_bookings and find_reschedule_slots
// tools return them, with what the agent should do next.

function presentSummary({ booking, area }: BookingRecord): BookingSummary {
  return {
    bookingId: booking.bookingId,
    providerId: booking.providerId,
    providerName: booking.providerName,
    service: booking.service,
    area: area ?? null,
    slot: { start: booking.slot.start, end: booking.slot.end },
    priceInr: booking.priceInr,
    status: booking.status,
    cancelledBy: booking.cancelledBy ?? null,
  };
}

export function presentBookingHistory(history: BookingHistory): ListBookingsOutput {
  const total = history.upcoming.length + history.past.length;
  return {
    upcoming: history.upcoming.map(presentSummary),
    past: history.past.map(presentSummary),
    message:
      total === 0
        ? "The person has no bookings yet."
        : "Pick the booking the person means from these. To cancel or move an upcoming one, call propose_action with its bookingId; " +
          "for the same provider as a past one, search that provider's service and area and hold that provider's slot.",
  };
}

function notChangeable(booking: Booking): string {
  if (booking.cancelledBy === "provider") return "That booking was already cancelled by the provider, so it can't be moved.";
  return `That booking is ${booking.status === "upcoming" ? "already under way" : booking.status}, so it can't be moved.`;
}

export function presentRescheduleSlots(outcome: FindRescheduleSlotsOutcome): FindRescheduleSlotsOutput {
  switch (outcome.kind) {
    case "slots":
      return {
        kind: "slots",
        bookingId: outcome.booking.bookingId,
        currentSlot: { start: outcome.booking.slot.start, end: outcome.booking.slot.end },
        slots: outcome.slots.map((slot) => ({ start: slot.start, end: slot.end })),
        message:
          outcome.slots.length === 0
            ? "The provider has no free slot on those dates. Ask the person for other dates."
            : "Pick the slot closest to what the person asked for (the same time of day, if they named none) and call propose_action with action reschedule.",
      };
    case "booking_not_found":
      return { kind: "booking_not_found", message: "The person has no booking with that ID. Call list_bookings and use a bookingId from it." };
    case "not_changeable":
      return { kind: "not_changeable", bookingId: outcome.booking.bookingId, status: outcome.booking.status, message: notChangeable(outcome.booking) };
    case "provider_not_found":
      return { kind: "provider_not_found", bookingId: outcome.booking.bookingId, message: "The booking's provider no longer exists." };
    case "invalid_date_range":
      return { kind: "invalid_date_range", bookingId: outcome.booking.bookingId, reason: outcome.reason, message: outcome.reason };
  }
}
