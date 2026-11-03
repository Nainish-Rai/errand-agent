import { describe, expect, it } from "vitest";

import { providersShownBySearch, repeatsSearchCards } from "./repeats";

const SLOT = { start: "2026-11-05T08:00:00+05:30", end: "2026-11-05T09:00:00+05:30" };

function provider(id: string) {
  return {
    id,
    name: id,
    service: "plumber",
    area: "Koramangala",
    priceInr: 399,
    rating: 4.5,
    reviewCount: 10,
    attributes: [],
    freeSlots: [SLOT],
    image: "plumbing",
    photos: [],
  };
}

const errand = { errandId: "e", state: "choosing", service: "plumber", area: "Koramangala", timeWindow: null, budgetInr: null, preferences: [], missing: [], question: null, transitions: [] };

const FOUND = {
  kind: "found",
  options: [{ providerId: "a", tags: ["cheapest"], reason: "Cheapest", earliestSlot: SLOT }],
  providers: [provider("a"), provider("b")],
  excluded: { overBudget: 0, outsideTimeWindow: 0 },
  errand,
};

describe("provider cards the reply's search already shows", () => {
  it("collects the options and every other fit of a found search", () => {
    const shown = providersShownBySearch([FOUND, { kind: "missing_details" }]);
    expect([...shown].sort()).toEqual(["a", "b"]);
  });

  it("calls cards a repeat only when every provider is already shown", () => {
    const shown = new Set(["a", "b"]);
    expect(repeatsSearchCards(["a", "b"], shown)).toBe(true);
    expect(repeatsSearchCards(["a", "c"], shown)).toBe(false);
    expect(repeatsSearchCards([], shown)).toBe(false);
  });
});
