import type { Clock } from "../ports/clock";
import type { ProviderWorld } from "../ports/provider-world";

// GetAvailability: how many free slots each provider has on each day of this week (today and the
// six days after, in IST), read from the world one day at a time. It feeds the slots-per-day
// chart, so the chart's numbers are the world's, whatever the model wrote.

const DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1_000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1_000;

export interface ProviderDayAvailability {
  readonly providerId: string;
  readonly freeSlots: number;
}

export interface DayAvailability {
  /** YYYY-MM-DD in IST. */
  readonly date: string;
  /** Free slots of every asked provider on that day, together. */
  readonly freeSlots: number;
  readonly byProvider: readonly ProviderDayAvailability[];
}

export interface Availability {
  readonly days: readonly DayAvailability[];
  /** Asked-for ids the world doesn't have. */
  readonly unknownProviderIds: readonly string[];
}

function istDate(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export async function getAvailability(
  deps: { readonly world: ProviderWorld; readonly clock: Clock },
  providerIds: readonly string[],
): Promise<Availability> {
  const now = deps.clock.now().getTime();
  const dates = Array.from({ length: DAYS }, (_, offset) => istDate(now + offset * DAY_MS));
  const lookups = await Promise.all(providerIds.map(async (providerId) => ({ providerId, outcome: await deps.world.getProvider(providerId) })));
  const known = lookups.flatMap(({ outcome }) => (outcome.kind === "found" ? [outcome.provider] : []));

  const days = await Promise.all(
    dates.map(async (date): Promise<DayAvailability> => {
      const byProvider = await Promise.all(
        known.map(async (provider): Promise<ProviderDayAvailability> => {
          const search = await deps.world.searchProviders({ service: provider.service, area: provider.area, dateRange: { from: date, to: date } });
          const found = search.kind === "found" ? search.providers.find((candidate) => candidate.id === provider.id) : undefined;
          return { providerId: provider.id, freeSlots: found?.freeSlots.length ?? 0 };
        }),
      );
      return { date, freeSlots: byProvider.reduce((sum, entry) => sum + entry.freeSlots, 0), byProvider };
    }),
  );
  return { days, unknownProviderIds: lookups.filter(({ outcome }) => outcome.kind !== "found").map(({ providerId }) => providerId) };
}
