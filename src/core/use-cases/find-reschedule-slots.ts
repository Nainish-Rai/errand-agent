import { isChangeable, isSameSlot } from "../booking/booking-change";
import type { Booking, DateRange, Slot } from "../ports/provider-world";
import { bookingOf, freeSlotsOf } from "./booking-change-session";
import type { ProposalDependencies } from "./proposal-session";

// FindRescheduleSlots: where a booking could move to. A booking stays with its provider when it
// moves, so the answer is that provider's free slots on the dates asked, from the world's own
// search. The agent proposes one of them; any other slot is refused when the card is made.

export type FindRescheduleSlotsOutcome =
  | { readonly kind: "slots"; readonly booking: Booking; readonly slots: readonly Slot[] }
  | { readonly kind: "booking_not_found" }
  | { readonly kind: "not_changeable"; readonly booking: Booking }
  | { readonly kind: "provider_not_found"; readonly booking: Booking }
  | { readonly kind: "invalid_date_range"; readonly booking: Booking; readonly reason: string };

export async function findRescheduleSlots(
  deps: Pick<ProposalDependencies, "world" | "worldClock">,
  request: { readonly userId: string; readonly bookingId: string; readonly dates: DateRange },
): Promise<FindRescheduleSlotsOutcome> {
  const booking = await bookingOf(deps.world, request.userId, request.bookingId);
  if (booking === undefined) return { kind: "booking_not_found" };
  if (!isChangeable(booking, deps.worldClock.now().getTime())) return { kind: "not_changeable", booking };
  const provider = await deps.world.getProvider(booking.providerId);
  if (provider.kind !== "found") return { kind: "provider_not_found", booking };
  const free = await freeSlotsOf(deps.world, provider.provider, request.dates);
  if (free.kind === "invalid_date_range") return { kind: "invalid_date_range", booking, reason: free.reason };
  return { kind: "slots", booking, slots: free.slots.filter((slot) => !isSameSlot(slot, booking.slot)) };
}
