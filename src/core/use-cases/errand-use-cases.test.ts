import { describe, expect, it } from "vitest";

import type { Errand } from "../errand/errand";
import type { ErrandChange, ErrandStore } from "../ports/errand-store";
import type { ProviderSummary, ProviderWorld, SearchOutcome, SearchQuery } from "../ports/provider-world";
import type { ServiceCatalog } from "../ports/service-catalog";
import type { TraceEvent, TraceRecord, TraceSink } from "../ports/trace-sink";
import { findErrandOptions } from "./find-errand-options";
import { getErrand } from "./get-errand";
import { updateErrand } from "./update-errand";

// The errand use cases against in-memory ports: a store, a catalog, a trace sink and a world that
// answers every search with the same providers.

class MemoryStore implements ErrandStore {
  readonly errands = new Map<string, Errand>();
  async find(sessionId: string) {
    return this.errands.get(sessionId);
  }
  async change<T>(sessionId: string, change: (current: Errand | undefined) => Promise<ErrandChange<T>>) {
    const { errand, result } = await change(this.errands.get(sessionId));
    if (errand !== undefined) this.errands.set(sessionId, errand);
    return result;
  }
}

class MemorySink implements TraceSink {
  readonly records: TraceRecord[] = [];
  async record(record: TraceRecord) {
    this.records.push(record);
  }
  async read() {
    return this.records;
  }
  get transitions(): TraceEvent[] {
    return this.records.filter((record): record is TraceEvent => record.type === "event" && record.kind === "state_transition");
  }
}

const catalog: ServiceCatalog = {
  services: () => ["plumber", "electrician"],
  areas: () => ["Koramangala", "HSR Layout"],
  resolveService: (text) => (["plumber", "electrician"] as const).find((service) => service === text.trim().toLowerCase()),
  resolveArea: (text) => ({ koramangala: "Koramangala", hsr: "HSR Layout", "hsr layout": "HSR Layout" })[text.trim().toLowerCase()],
};

function providerAt(id: string, priceInr: number, rating: number, start: string): ProviderSummary {
  const end = start.replace(/T(\d\d)/, (_, hour: string) => `T${String(Number(hour) + 1).padStart(2, "0")}`);
  return { id, name: id, service: "plumber", area: "Koramangala", priceInr, rating, reviewCount: 50, freeSlots: [{ start, end }], attributes: [] };
}

const PROVIDERS = [
  providerAt("a", 499, 4.8, "2026-11-05T09:00:00+05:30"),
  providerAt("b", 399, 4.2, "2026-11-07T10:00:00+05:30"),
  providerAt("c", 1_499, 4.9, "2026-11-04T10:00:00+05:30"),
  providerAt("d", 899, 4.5, "2026-11-04T18:00:00+05:30"),
];

function worldAnswering(outcome: SearchOutcome): ProviderWorld & { readonly queries: SearchQuery[] } {
  const queries: SearchQuery[] = [];
  const unused = () => Promise.reject(new Error("not used"));
  return {
    queries,
    searchProviders: async (query) => {
      queries.push(query);
      return outcome;
    },
    getProvider: unused,
    listBookings: unused,
    holdSlot: unused,
    book: unused,
    getBookingStatus: unused,
    cancel: unused,
    reschedule: unused,
  };
}

function setup(outcome: SearchOutcome = { kind: "found", providers: PROVIDERS }) {
  let now = 1_000;
  const deps = {
    errands: new MemoryStore(),
    catalog,
    traceSink: new MemorySink(),
    clock: { now: () => new Date((now += 1)) },
    world: worldAnswering(outcome),
  };
  const place = { traceId: "s1", sessionId: "s1", spanId: "tool:s1:c1" };
  return { deps, place };
}

const WEEK = { from: "2026-11-04", to: "2026-11-10" };

describe("updating the errand", () => {
  it("the first detail opens the errand in gathering and records the start in the trace", async () => {
    const { deps, place } = setup();
    const outcome = await updateErrand(deps, { place, patch: { service: "plumber", timeWindow: { dates: WEEK } } });
    expect(outcome.kind).toBe("updated");
    expect(outcome.errand.state).toBe("gathering");
    expect(outcome.errand.details).toEqual({ service: "plumber", timeWindow: { dates: WEEK }, preferences: [] });
    expect(deps.traceSink.transitions.map((event) => event.name)).toEqual(["start → gathering"]);
  });

  it("a correction changes one field and leaves the others", async () => {
    const { deps, place } = setup();
    await updateErrand(deps, {
      place,
      patch: { service: "plumber", area: "koramangala", timeWindow: { dates: WEEK }, budget: { maxInr: 1_500 } },
    });
    const saturday = { dates: { from: "2026-11-07", to: "2026-11-07" } };
    const outcome = await updateErrand(deps, { place, patch: { timeWindow: saturday } });
    expect(outcome).toMatchObject({ kind: "updated", changed: ["timeWindow"] });
    expect((await getErrand(deps.errands, "s1"))?.details).toEqual({
      service: "plumber",
      area: "Koramangala",
      timeWindow: saturday,
      budget: { maxInr: 1_500 },
      preferences: [],
    });
  });

  it("an area the world doesn't cover is refused with the known areas, and nothing changes", async () => {
    const { deps, place } = setup();
    await updateErrand(deps, { place, patch: { area: "koramangala" } });
    const outcome = await updateErrand(deps, { place, patch: { area: "Atlantis" } });
    expect(outcome).toMatchObject({ kind: "unknown_area", knownAreas: ["Koramangala", "HSR Layout"] });
    expect((await getErrand(deps.errands, "s1"))?.details.area).toBe("Koramangala");
  });

  it("a correction while options are shown sends the errand back to gathering", async () => {
    const { deps, place } = setup();
    await findErrandOptions(deps, { place, search: { service: "plumber", area: "Koramangala", dates: WEEK } });
    const outcome = await updateErrand(deps, { place, patch: { budget: { maxInr: 600 } } });
    expect(outcome.errand.state).toBe("gathering");
    expect(outcome.errand.transitions.at(-1)).toMatchObject({ from: "choosing", to: "gathering", reason: "details_changed" });
  });
});

describe("finding options", () => {
  it("moves gathering → searching → choosing and writes each move to the trace", async () => {
    const { deps, place } = setup();
    const outcome = await findErrandOptions(deps, { place, search: { service: "plumber", area: "Koramangala", dates: WEEK } });
    expect(outcome.kind).toBe("options");
    expect(outcome.errand.state).toBe("choosing");
    expect(deps.traceSink.transitions.map((event) => event.name)).toEqual([
      "start → gathering",
      "gathering → searching",
      "searching → choosing",
    ]);
    expect(deps.traceSink.transitions.every((event) => event.spanId === "tool:s1:c1")).toBe(true);
  });

  it("no option shown is over the budget or outside the hours of the time window", async () => {
    const { deps, place } = setup();
    await updateErrand(deps, { place, patch: { budget: { maxInr: 1_000 }, timeWindow: { dates: WEEK, hours: { from: 8, to: 12 } } } });
    const outcome = await findErrandOptions(deps, { place, search: { service: "plumber", area: "Koramangala", dates: WEEK } });
    if (outcome.kind !== "options") throw new Error(outcome.kind);
    // c is over budget; d's only slot is at 18:00.
    expect(outcome.selection.eligible.map((option) => option.provider.id).sort()).toEqual(["a", "b"]);
    expect(outcome.selection.excluded).toEqual({ overBudget: 1, outsideTimeWindow: 1 });
    // The search kept the hours the person gave earlier.
    expect(outcome.errand.details.timeWindow).toEqual({ dates: WEEK, hours: { from: 8, to: 12 } });
  });

  it("when nothing fits, the errand goes back to gathering with the reason", async () => {
    const { deps, place } = setup();
    await updateErrand(deps, { place, patch: { budget: { maxInr: 100 } } });
    const outcome = await findErrandOptions(deps, { place, search: { service: "plumber", area: "Koramangala", dates: WEEK } });
    expect(outcome).toMatchObject({ kind: "no_options", excluded: { overBudget: 4, outsideTimeWindow: 0 }, searched: 4 });
    expect(outcome.errand.state).toBe("gathering");
  });

  it("a search the world refuses goes back to gathering", async () => {
    const { deps, place } = setup({ kind: "invalid_date_range", reason: "too far ahead" });
    const outcome = await findErrandOptions(deps, { place, search: { service: "plumber", area: "Koramangala", dates: WEEK } });
    expect(outcome).toMatchObject({ kind: "invalid_date_range", reason: "too far ahead" });
    expect(outcome.errand.transitions.map((transition) => transition.reason)).toEqual(["errand_started", "search_started", "search_rejected"]);
  });

  it("searches with the catalog's spelling of the area", async () => {
    const { deps, place } = setup();
    await findErrandOptions(deps, { place, search: { service: "plumber", area: "hsr", dates: WEEK } });
    expect(deps.world.queries).toEqual([{ service: "plumber", area: "HSR Layout", dateRange: WEEK }]);
  });

  it("an unknown service is refused before the world is asked", async () => {
    const { deps, place } = setup();
    const outcome = await findErrandOptions(deps, { place, search: { service: "astrologer", area: "Koramangala", dates: WEEK } });
    expect(outcome).toMatchObject({ kind: "unknown_service", knownServices: ["plumber", "electrician"] });
    expect(deps.world.queries).toEqual([]);
  });
});
