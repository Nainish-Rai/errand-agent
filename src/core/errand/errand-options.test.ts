import { describe, expect, it } from "vitest";

import type { ProviderSummary, Slot } from "../ports/provider-world";
import type { ErrandDetails, TimeWindow } from "./errand";
import { fitsBudget, fitsTimeWindow, selectOptions } from "./errand-options";

function slot(day: string, hour: number): Slot {
  const pad = (value: number) => String(value).padStart(2, "0");
  return { start: `${day}T${pad(hour)}:00:00+05:30`, end: `${day}T${pad(hour + 1)}:00:00+05:30` };
}

function provider(id: string, priceInr: number, rating: number, slots: Slot[], attributes: string[] = []): ProviderSummary {
  return { id, name: id, service: "plumber", area: "Koramangala", priceInr, rating, reviewCount: 100, freeSlots: slots, attributes, image: "plumbing", photos: [] };
}

const WEEK: TimeWindow = { dates: { from: "2026-11-04", to: "2026-11-10" } };
const MORNINGS: TimeWindow = { ...WEEK, hours: { from: 8, to: 12 } };

function details(timeWindow: TimeWindow, maxInr?: number, preferences: string[] = []): ErrandDetails & { timeWindow: TimeWindow } {
  return {
    service: "plumber",
    area: "Koramangala",
    timeWindow,
    ...(maxInr === undefined ? {} : { budget: { maxInr } }),
    preferences,
  };
}

describe("the budget", () => {
  it("a price equal to the budget fits; one rupee over does not", () => {
    expect(fitsBudget(provider("a", 1_500, 4, []), { maxInr: 1_500 })).toBe(true);
    expect(fitsBudget(provider("a", 1_501, 4, []), { maxInr: 1_500 })).toBe(false);
  });

  it("no budget means every price fits", () => {
    expect(fitsBudget(provider("a", 99_999, 4, []), undefined)).toBe(true);
  });
});

describe("the time window", () => {
  it("keeps slots on the window's first and last days and drops the day after", () => {
    expect(fitsTimeWindow(slot("2026-11-04", 9), WEEK)).toBe(true);
    expect(fitsTimeWindow(slot("2026-11-10", 18), WEEK)).toBe(true);
    expect(fitsTimeWindow(slot("2026-11-11", 9), WEEK)).toBe(false);
    expect(fitsTimeWindow(slot("2026-11-03", 9), WEEK)).toBe(false);
  });

  it("mornings 8 to 12 keep 8:00 and 11:00 and drop 7:00 and 12:00", () => {
    expect(fitsTimeWindow(slot("2026-11-05", 8), MORNINGS)).toBe(true);
    expect(fitsTimeWindow(slot("2026-11-05", 11), MORNINGS)).toBe(true);
    expect(fitsTimeWindow(slot("2026-11-05", 7), MORNINGS)).toBe(false);
    expect(fitsTimeWindow(slot("2026-11-05", 12), MORNINGS)).toBe(false);
  });

  it("reads the day in IST even when the slot is written in UTC", () => {
    // 2026-11-04T20:00Z is 01:30 on the 5th in IST.
    expect(fitsTimeWindow({ start: "2026-11-04T20:00:00Z", end: "2026-11-04T21:00:00Z" }, { dates: { from: "2026-11-05", to: "2026-11-05" } })).toBe(true);
  });
});

describe("choosing the options", () => {
  const cheap = provider("cheap", 399, 4.1, [slot("2026-11-06", 9)]);
  const early = provider("early", 899, 4.3, [slot("2026-11-04", 10)]);
  const best = provider("best", 999, 4.9, [slot("2026-11-05", 9)]);
  const pricey = provider("pricey", 1_800, 5.0, [slot("2026-11-04", 9)]);
  const evenings = provider("evenings", 499, 4.8, [slot("2026-11-04", 18)]);

  it("tags the best match, the cheapest and the earliest, in that order", () => {
    const { options } = selectOptions([cheap, early, best], details(WEEK));
    expect(options.map((option) => [option.provider.id, option.tags])).toEqual([
      ["best", ["best_match"]],
      ["cheap", ["cheapest"]],
      ["early", ["earliest"]],
    ]);
  });

  it("drops a provider over budget and counts it", () => {
    const selection = selectOptions([cheap, early, best, pricey], details(WEEK, 1_000));
    expect(selection.eligible.map((option) => option.provider.id)).not.toContain("pricey");
    expect(selection.excluded).toEqual({ overBudget: 1, outsideTimeWindow: 0 });
  });

  it("drops a provider with no free slot in the window and keeps only the slots inside it", () => {
    const both = provider("both", 599, 4.0, [slot("2026-11-04", 18), slot("2026-11-05", 9)]);
    const selection = selectOptions([evenings, both], details(MORNINGS));
    expect(selection.eligible.map((option) => option.provider.id)).toEqual(["both"]);
    expect(selection.eligible[0]?.slots).toEqual([slot("2026-11-05", 9)]);
    expect(selection.excluded).toEqual({ overBudget: 0, outsideTimeWindow: 1 });
  });

  it("one provider can win several tags, and a runner-up keeps it a choice of two", () => {
    const winner = provider("winner", 399, 4.9, [slot("2026-11-04", 9)]);
    const other = provider("other", 899, 4.0, [slot("2026-11-06", 9)]);
    const { options } = selectOptions([other, winner], details(WEEK));
    expect(options.map((option) => [option.provider.id, option.tags])).toEqual([
      ["winner", ["best_match", "cheapest", "earliest"]],
      ["other", ["runner_up"]],
    ]);
  });

  it("never shows more than three options", () => {
    const many = Array.from({ length: 8 }, (_, index) => provider(`p${index}`, 400 + index * 50, 4 + index / 10, [slot("2026-11-05", 9 + (index % 3))]));
    const { options } = selectOptions(many, details(WEEK));
    expect(options.length).toBeGreaterThanOrEqual(2);
    expect(options.length).toBeLessThanOrEqual(3);
  });

  it("a provider meeting the person's preference is the best match over a higher rating", () => {
    const parts = provider("parts", 799, 4.2, [slot("2026-11-05", 9)], ["parts_included"]);
    const { options } = selectOptions([best, parts], details(WEEK, undefined, ["parts included"]));
    expect(options[0]?.provider.id).toBe("parts");
    expect(options[0]?.tags).toContain("best_match");
  });

  it("nothing fits: no options, and the exclusions say why", () => {
    const selection = selectOptions([pricey, evenings], details(MORNINGS, 1_000));
    expect(selection.options).toEqual([]);
    expect(selection.excluded).toEqual({ overBudget: 1, outsideTimeWindow: 1 });
  });
});
