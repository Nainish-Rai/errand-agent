import { closestSlots } from "../booking/booking-change";
import { istDayOf } from "../calendar/ist-day";
import type { Booking, DateRange, ProviderDetails, ProviderWorld, Slot } from "../ports/provider-world";

// What the cancel and reschedule use cases read from the world: the person's booking as the world
// lists it, and the free slots its provider has. Both come through the assignment's tools
// (`list_bookings`, `get_provider`, `search_providers`), so nothing here trusts the model's words.

/** How many other slots a refused move offers instead. */
export const ALTERNATIVE_SLOTS = 3;

/** The person's booking with this ID, as `list_bookings` has it now. */
export async function bookingOf(world: ProviderWorld, userId: string, bookingId: string): Promise<Booking | undefined> {
  return (await world.listBookings(userId)).find((booking) => booking.bookingId === bookingId);
}

export type FreeSlotsOutcome =
  | { readonly kind: "slots"; readonly slots: readonly Slot[] }
  | { readonly kind: "invalid_date_range"; readonly reason: string };

/** The provider's free slots on these dates, earliest first, from the world's own search. */
export async function freeSlotsOf(world: ProviderWorld, provider: ProviderDetails, dates: DateRange): Promise<FreeSlotsOutcome> {
  const found = await world.searchProviders({ service: provider.service, area: provider.area, dateRange: dates });
  if (found.kind === "invalid_date_range") return { kind: "invalid_date_range", reason: found.reason };
  if (found.kind !== "found") return { kind: "slots", slots: [] };
  const own = found.providers.find((candidate) => candidate.id === provider.id);
  return { kind: "slots", slots: (own?.freeSlots ?? []).toSorted((a, b) => Date.parse(a.start) - Date.parse(b.start)) };
}

/** The provider's other free slots on the day of `wanted`, closest to it first. */
export async function alternativesTo(world: ProviderWorld, provider: ProviderDetails, wanted: Slot): Promise<readonly Slot[]> {
  const day = istDayOf(Date.parse(wanted.start));
  const free = await freeSlotsOf(world, provider, { from: day, to: day });
  return free.kind === "slots" ? closestSlots(free.slots, wanted, ALTERNATIVE_SLOTS) : [];
}
