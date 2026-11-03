import { describe, expect, it } from "vitest";

import { fieldsToAsk, missingFields, patchDetails, type ErrandDetails } from "./errand";

const FULL: ErrandDetails = {
  service: "plumber",
  area: "Koramangala",
  timeWindow: { dates: { from: "2026-11-04", to: "2026-11-10" }, hours: { from: 8, to: 12 } },
  budget: { maxInr: 1_500 },
  preferences: ["parts included"],
};

function patched(details: ErrandDetails, patch: Parameters<typeof patchDetails>[1]): ErrandDetails {
  const outcome = patchDetails(details, patch);
  if (outcome.kind !== "patched") throw new Error(`expected a patch, got ${outcome.kind}`);
  return outcome.details;
}

describe("patching an errand", () => {
  it("changing the date leaves service, area, budget and preferences as they were", () => {
    const saturday = { dates: { from: "2026-11-07", to: "2026-11-07" } };
    const next = patched(FULL, { timeWindow: saturday });
    expect(next).toEqual({ ...FULL, timeWindow: saturday });
  });

  it("each single-field patch changes exactly that field", () => {
    const patches = {
      service: { service: "electrician" },
      area: { area: "Indiranagar" },
      timeWindow: { timeWindow: { dates: { from: "2026-11-05", to: "2026-11-05" } } },
      budget: { budget: { maxInr: 900 } },
      preferences: { preferences: ["female technician"] },
    } as const;
    for (const [field, patch] of Object.entries(patches)) {
      const outcome = patchDetails(FULL, patch);
      expect(outcome).toEqual({ kind: "patched", details: { ...FULL, ...patch }, changed: [field] });
    }
  });

  it("an empty patch changes nothing", () => {
    expect(patchDetails(FULL, {})).toEqual({ kind: "patched", details: FULL, changed: [] });
  });

  it("repeating a value already held reports no change", () => {
    expect(patchDetails(FULL, { area: "Koramangala" })).toEqual({ kind: "patched", details: FULL, changed: [] });
  });

  it("an invalid field refuses the whole patch, so nothing half-applies", () => {
    const outcome = patchDetails(FULL, { area: "Indiranagar", budget: { maxInr: 0 } });
    expect(outcome).toEqual({ kind: "invalid_detail", field: "budget", reason: "budget_not_positive" });
  });

  it.each([
    [{ dates: { from: "2026-11-10", to: "2026-11-04" } }, "dates_reversed"],
    [{ dates: { from: "2026-11-01", to: "2026-11-20" } }, "range_too_long"],
    [{ dates: { from: "4 Nov", to: "2026-11-04" } }, "not_a_date"],
    [{ dates: { from: "2026-11-04", to: "2026-11-04" }, hours: { from: 12, to: 8 } }, "hours_reversed"],
    [{ dates: { from: "2026-11-04", to: "2026-11-04" }, hours: { from: 8, to: 25 } }, "hours_out_of_range"],
  ] as const)("a time window like %j is refused as %s", (timeWindow, reason) => {
    expect(patchDetails(FULL, { timeWindow })).toEqual({ kind: "invalid_detail", field: "timeWindow", reason });
  });

  it("a fourteen-day window is the longest accepted", () => {
    expect(patchDetails(FULL, { timeWindow: { dates: { from: "2026-11-01", to: "2026-11-14" } } }).kind).toBe("patched");
  });
});

describe("what is still missing", () => {
  it("a plumber this week is missing only the area", () => {
    const details: ErrandDetails = { service: "plumber", timeWindow: FULL.timeWindow, preferences: [] };
    expect(missingFields(details)).toEqual(["area"]);
    expect(fieldsToAsk(details)).toEqual(["area"]);
  });

  it("budget and preferences are never asked for", () => {
    const { budget: _budget, ...noBudget } = FULL;
    expect(missingFields({ ...noBudget, preferences: [] })).toEqual([]);
  });

  it("asks for at most two fields at a time", () => {
    expect(fieldsToAsk({ preferences: [] })).toEqual(["service", "area"]);
  });
});
