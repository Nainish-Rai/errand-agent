import type { ProviderSummary, Slot } from "../ports/provider-world";
import type { Budget, ErrandDetails, TimeWindow } from "./errand";

// From the world's search results to the two or three options the person sees. The constraints
// are applied here, in code, never left to the prompt: a provider over budget, or with no free
// slot inside the time window, is not an option.

/** `runner_up` only appears when one provider wins all three tags, so there is still a second choice. */
export type OptionTag = "best_match" | "cheapest" | "earliest" | "runner_up";

export interface ErrandOption {
  readonly provider: ProviderSummary;
  /** Why it is shown. One provider can win more than one tag. */
  readonly tags: readonly OptionTag[];
  /** The provider's free slots inside the time window, earliest first; never empty. */
  readonly slots: readonly Slot[];
  /** How many of the person's preferences the provider's attributes meet. */
  readonly preferencesMet: number;
}

export interface Exclusions {
  readonly overBudget: number;
  /** Within budget, but with no free slot inside the time window. */
  readonly outsideTimeWindow: number;
}

export interface OptionSelection {
  /** Every provider that fits, best match first; the options are taken from these. */
  readonly eligible: readonly ErrandOption[];
  /** Two or three options (fewer only when fewer fit), each with at least one tag. */
  readonly options: readonly ErrandOption[];
  readonly excluded: Exclusions;
}

/** At most this many options are shown, one per tag. */
export const MAX_OPTIONS = 3;
const MIN_OPTIONS = 2;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1_000;

/** The calendar date and the hour (with fraction) of an instant, in IST. */
function istParts(iso: string): { date: string; hour: number } {
  const ist = new Date(Date.parse(iso) + IST_OFFSET_MS);
  return {
    date: ist.toISOString().slice(0, 10),
    hour: ist.getUTCHours() + ist.getUTCMinutes() / 60,
  };
}

export function fitsBudget(provider: ProviderSummary, budget: Budget | undefined): boolean {
  return budget === undefined || provider.priceInr <= budget.maxInr;
}

export function fitsTimeWindow(slot: Slot, window: TimeWindow): boolean {
  const start = istParts(slot.start);
  const end = istParts(slot.end);
  if (start.date < window.dates.from || start.date > window.dates.to) return false;
  if (window.hours === undefined) return true;
  // A slot that ends at midnight reads as hour 0 of the next day; it ends at hour 24 of its own.
  const endHour = end.date > start.date && end.hour === 0 ? 24 : end.hour;
  return start.hour >= window.hours.from && endHour <= window.hours.to;
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** A preference is met when every word of it appears in one of the provider's attributes. */
function meetsPreference(provider: ProviderSummary, preference: string): boolean {
  const wanted = words(preference);
  if (wanted.length === 0) return false;
  return provider.attributes.some((attribute) => {
    const offered = words(attribute.replaceAll("_", " "));
    return wanted.every((word) => offered.includes(word));
  });
}

function startMs(option: ErrandOption): number {
  return Date.parse(option.slots[0]?.start ?? "");
}

/** Best match: most preferences met, then rating, then the number of reviews behind it, then price. */
function byBestMatch(a: ErrandOption, b: ErrandOption): number {
  return (
    b.preferencesMet - a.preferencesMet ||
    b.provider.rating - a.provider.rating ||
    b.provider.reviewCount - a.provider.reviewCount ||
    a.provider.priceInr - b.provider.priceInr ||
    a.provider.id.localeCompare(b.provider.id)
  );
}

function byPrice(a: ErrandOption, b: ErrandOption): number {
  return a.provider.priceInr - b.provider.priceInr || byBestMatch(a, b);
}

function byEarliest(a: ErrandOption, b: ErrandOption): number {
  return startMs(a) - startMs(b) || byBestMatch(a, b);
}

function candidateFor(provider: ProviderSummary, details: ErrandDetails, window: TimeWindow): ErrandOption {
  const slots = provider.freeSlots
    .filter((slot) => fitsTimeWindow(slot, window))
    .toSorted((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const preferencesMet = details.preferences.filter((preference) => meetsPreference(provider, preference)).length;
  return { provider, tags: [], slots, preferencesMet };
}

function tagged(eligible: readonly ErrandOption[]): ErrandOption[] {
  const winners: [OptionTag, ErrandOption | undefined][] = [
    ["best_match", eligible[0]],
    ["cheapest", eligible.toSorted(byPrice)[0]],
    ["earliest", eligible.toSorted(byEarliest)[0]],
  ];
  const options = new Map<string, ErrandOption>();
  for (const [tag, winner] of winners) {
    if (winner === undefined) continue;
    const current = options.get(winner.provider.id) ?? winner;
    options.set(winner.provider.id, { ...current, tags: [...current.tags, tag] });
  }
  // When one provider wins every tag, the runner-up best match keeps the choice a real one.
  const runnerUp = eligible.find((option) => !options.has(option.provider.id));
  if (options.size < MIN_OPTIONS && runnerUp !== undefined) {
    options.set(runnerUp.provider.id, { ...runnerUp, tags: ["runner_up"] });
  }
  return [...options.values()].slice(0, MAX_OPTIONS);
}

/**
 * Drops every provider over budget or without a free slot in the time window, then tags the best
 * match, the cheapest and the earliest of the rest. The details must hold a time window.
 */
export function selectOptions(
  providers: readonly ProviderSummary[],
  details: ErrandDetails & { readonly timeWindow: TimeWindow },
): OptionSelection {
  const withinBudget = providers.filter((provider) => fitsBudget(provider, details.budget));
  const eligible = withinBudget
    .map((provider) => candidateFor(provider, details, details.timeWindow))
    .filter((option) => option.slots.length > 0)
    .toSorted(byBestMatch);
  return {
    eligible,
    options: tagged(eligible),
    excluded: {
      overBudget: providers.length - withinBudget.length,
      outsideTimeWindow: withinBudget.length - eligible.length,
    },
  };
}
