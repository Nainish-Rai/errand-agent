import type {
  BookingView,
  GetAvailabilityResponse,
  GetSpendResponse,
  ProviderChoiceProps,
  ProviderDetails,
  Slot,
} from "@errand/contracts";

// Data binding for generated UI: the model names ids and writes a short highlight and reason; every
// fact a component shows (name, price, rating, photo, slot, status, chart values) comes from the
// read-only API. These functions are the only way the chat's components get their values, and the
// evals call the same functions to prove a shown value equals the world's.

const slotFormat = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

const dayFormat = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const monthFormat = new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });

export function slotLabel(slot: Slot): string {
  return `${slotFormat.format(new Date(slot.start))} IST`;
}

/** "Thu, 5 Nov" for a YYYY-MM-DD day in IST. */
export function dayLabel(date: string): string {
  return dayFormat.format(new Date(`${date}T12:00:00+05:30`));
}

export function rupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

/**
 * Text the model wrote, shown only when it states no fact: anything with a digit or a currency sign
 * could be a price, rating, time or count the world didn't say, so it isn't shown at all.
 */
export function modelText(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const trimmed = text.trim();
  if (trimmed === "" || /[\d₹$€£]|\brs\.?\b|\binr\b/i.test(trimmed)) return undefined;
  return trimmed;
}

export interface BoundChoice {
  readonly providerId: string;
  readonly name: string;
  readonly priceInr: number;
  readonly rating: number;
  readonly reviewCount: number;
  readonly earliestSlot: Slot | undefined;
  /** The cover photo's image asset key, as the world named it: untrusted, so clients resolve it themselves. */
  readonly photo: string | undefined;
  readonly attributes: readonly string[];
  /** The model's words, only when they state no fact. */
  readonly highlight: string | undefined;
  readonly reason: string | undefined;
}

/**
 * One choice card from the model's ids and words plus the provider the world returned. `earliest`
 * is the world's earliest slot for this errand when the card shows a search option; otherwise the
 * provider's first free slot this week.
 */
export function bindChoice(choice: ProviderChoiceProps, provider: ProviderDetails, earliest?: Slot): BoundChoice {
  const [cover] = provider.photos;
  return {
    providerId: provider.id,
    name: provider.name,
    priceInr: provider.priceInr,
    rating: provider.rating,
    reviewCount: provider.reviewCount,
    earliestSlot: earliest ?? provider.freeSlots[0],
    photo: cover,
    attributes: provider.attributes,
    highlight: modelText(choice.highlight),
    reason: modelText(choice.reason),
  };
}

/** Choices whose provider the world has, in the model's order; unknown ids are left out. */
export function bindChoices(choices: readonly ProviderChoiceProps[], providers: readonly ProviderDetails[]): BoundChoice[] {
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  return choices.flatMap((choice) => {
    const provider = byId.get(choice.providerId);
    return provider === undefined ? [] : [bindChoice(choice, provider)];
  });
}

export interface PriceBar {
  readonly providerId: string;
  readonly name: string;
  readonly priceInr: number;
}

export function bindPriceChart(providerIds: readonly string[], providers: readonly ProviderDetails[]): PriceBar[] {
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  return providerIds.flatMap((id) => {
    const provider = byId.get(id);
    return provider === undefined ? [] : [{ providerId: id, name: provider.name, priceInr: provider.priceInr }];
  });
}

export interface DayBar {
  readonly date: string;
  readonly label: string;
  readonly freeSlots: number;
}

export function bindSlotsPerDay(availability: GetAvailabilityResponse): DayBar[] {
  return availability.days.map((day) => ({ date: day.date, label: dayLabel(day.date), freeSlots: day.freeSlots }));
}

export interface MonthBar {
  readonly month: string;
  readonly label: string;
  readonly spendInr: number;
  readonly bookings: number;
}

export function bindSpend(spend: GetSpendResponse): MonthBar[] {
  return spend.months.map((month) => ({
    month: month.month,
    label: monthFormat.format(new Date(`${month.month}-01T00:00:00Z`)),
    spendInr: month.spendInr,
    bookings: month.bookings,
  }));
}

export interface BoundBooking {
  readonly bookingId: string;
  readonly providerName: string;
  readonly slot: Slot;
  readonly priceInr: number;
  readonly status: string;
}

export function bindBookings(bookingIds: readonly string[], bookings: readonly BookingView[]): BoundBooking[] {
  const byId = new Map(bookings.map((booking) => [booking.bookingId, booking]));
  return bookingIds.flatMap((id) => {
    const booking = byId.get(id);
    return booking === undefined
      ? []
      : [{ bookingId: id, providerName: booking.providerName, slot: booking.slot, priceInr: booking.priceInr, status: booking.status }];
  });
}
