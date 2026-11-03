import { describe, expect, it } from "vitest";

import type { Proposal } from "../approval/proposal";
import type { Errand } from "../errand/errand";
import type { ErrandState, ErrandTransition } from "../errand/errand-workflow";
import { bookingActivity, composerDefaults, errandsAtWork, homeAlerts, upcomingVisits } from "../home/home-summary";
import type { MemoryFact } from "../memory/memory-fact";
import type { ErrandChange, ErrandStore } from "../ports/errand-store";
import type { Booking } from "../ports/provider-world";
import type { ServiceCatalog } from "../ports/service-catalog";
import type { TraceEvent, TraceRecord, TraceSink } from "../ports/trace-sink";
import { draftErrand } from "./draft-errand";

// The home screen's use cases against in-memory ports: the composer's draft and the widget
// derivations. They assert what is stored and what each widget would show.

class Errands implements ErrandStore {
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

class Sink implements TraceSink {
  readonly records: TraceRecord[] = [];
  async record(record: TraceRecord) {
    this.records.push(record);
  }
  async read() {
    return this.records;
  }
  eventsOf(kind: TraceEvent["kind"]): TraceEvent[] {
    return this.records.filter((record): record is TraceEvent => record.type === "event" && record.kind === kind);
  }
}

const catalog: ServiceCatalog = {
  services: () => ["plumber", "electrician"],
  areas: () => ["Koramangala", "HSR Layout"],
  resolveService: (text) => (["plumber", "electrician"] as const).find((service) => service === text.trim().toLowerCase()),
  resolveArea: (text) => ({ koramangala: "Koramangala", hsr: "HSR Layout", "hsr layout": "HSR Layout" })[text.trim().toLowerCase()],
};

// 2026-11-04 09:00 IST.
const NOW = Date.parse("2026-11-04T09:00:00+05:30");

function setup() {
  const deps = {
    errands: new Errands(),
    catalog,
    traceSink: new Sink(),
    clock: { now: () => new Date(NOW + 5) },
    calendar: { now: () => new Date(NOW) },
  };
  return { deps, place: { traceId: "s1", sessionId: "s1" } };
}

describe("drafting the errand from the home composer", () => {
  it("the chips become the errand before the first message: area, budget, and mornings this week", async () => {
    const { deps, place } = setup();
    const outcome = await draftErrand(deps, {
      place,
      draft: { area: "koramangala", budget: { maxInr: 1_500 }, thisWeek: { hours: { from: 8, to: 12 } } },
    });
    expect(outcome.kind).toBe("drafted");
    expect(deps.errands.errands.get("s1")?.details).toEqual({
      area: "Koramangala",
      budget: { maxInr: 1_500 },
      timeWindow: { dates: { from: "2026-11-04", to: "2026-11-10" }, hours: { from: 8, to: 12 } },
      preferences: [],
    });
    expect(deps.errands.errands.get("s1")?.state).toBe("gathering");
    expect(deps.traceSink.eventsOf("errand_drafted").map((event) => event.name)).toEqual([
      "composer → errand: area, timeWindow, budget",
    ]);
  });

  it("this week with no hours is the whole of each day", async () => {
    const { deps, place } = setup();
    await draftErrand(deps, { place, draft: { thisWeek: {} } });
    expect(deps.errands.errands.get("s1")?.details.timeWindow).toEqual({ dates: { from: "2026-11-04", to: "2026-11-10" } });
  });

  it("a session that already has an errand is left as it is", async () => {
    const { deps, place } = setup();
    await draftErrand(deps, { place, draft: { area: "HSR" } });
    const outcome = await draftErrand(deps, { place, draft: { area: "Koramangala" } });
    expect(outcome.kind).toBe("errand_exists");
    expect(deps.errands.errands.get("s1")?.details.area).toBe("HSR Layout");
  });

  it("an area outside the catalog is refused and leaves no errand behind for memory to trip over", async () => {
    const { deps, place } = setup();
    const outcome = await draftErrand(deps, { place, draft: { area: "Atlantis", budget: { maxInr: 900 } } });
    expect(outcome).toEqual({ kind: "unknown_area", knownAreas: ["Koramangala", "HSR Layout"] });
    expect(deps.errands.errands.size).toBe(0);
  });

  it("an empty composer drafts nothing, so the conversation and memory start the errand", async () => {
    const { deps, place } = setup();
    expect((await draftErrand(deps, { place, draft: {} })).kind).toBe("empty_draft");
    expect(deps.errands.errands.size).toBe(0);
    expect(deps.traceSink.records).toEqual([]);
  });
});

function errandMoving(sessionId: string, path: readonly ErrandState[], startMs = NOW - 60_000): Errand {
  const transitions: ErrandTransition[] = path.map((to, sequence) => ({
    sequence,
    ...(sequence === 0 ? {} : { from: path[sequence - 1] }),
    to,
    reason: "errand_started",
    atMs: startMs + sequence * 1_000,
  }));
  return {
    errandId: `errand_${sessionId}`,
    sessionId,
    details: { service: "plumber", area: "Koramangala", preferences: [] },
    state: path.at(-1) ?? "gathering",
    transitions,
  };
}

function booking(id: string, start: string, status: Booking["status"] = "upcoming", priceInr = 500): Booking {
  return {
    bookingId: id,
    userId: "u",
    providerId: "p",
    providerName: `Provider ${id}`,
    service: "plumber",
    slot: { start, end: start.replace("T10", "T11") },
    priceInr,
    status,
  };
}

function proposal(id: string, status: Proposal["status"], start: string, bookingId?: string): Proposal {
  return {
    proposalId: id,
    sessionId: "s1",
    userId: "u",
    fingerprint: "f",
    status,
    createdAtMs: NOW,
    ...(bookingId === undefined ? {} : { bookingId }),
    terms: {
      action: "book",
      providerId: "p",
      providerName: "Ravi Plumbing",
      service: "plumber",
      rating: 4.5,
      area: "Koramangala",
      cancellationTerms: "free",
      holdId: "h",
      holdExpiresAt: start,
      slot: { start, end: start },
      priceInr: 899,
    },
  };
}

function fact(key: MemoryFact["key"], value: string, status: MemoryFact["status"], validToMs?: number): MemoryFact {
  return {
    id: `${key}_${status}`,
    ownerId: "o",
    key,
    value,
    source: status === "pending_confirmation" ? "inferred" : "explicit",
    status,
    evidence: { kind: "user_action", action: "seed" },
    validFromMs: NOW - 1_000,
    ...(validToMs === undefined ? {} : { validToMs }),
  };
}

describe("the home widgets", () => {
  it("Working now lists unfinished errands, newest move first, and says whose move it is", () => {
    const working = errandsAtWork([
      errandMoving("searching", ["gathering", "searching"], NOW - 120_000),
      errandMoving("approval", ["gathering", "searching", "choosing", "holding", "awaiting_approval"]),
      errandMoving("finished", ["gathering", "searching", "choosing", "holding", "awaiting_approval", "executing", "done"]),
    ]);
    expect(working.map(({ errand, waitingOn }) => [errand.sessionId, waitingOn])).toEqual([
      ["approval", "person"],
      ["searching", "agent"],
    ]);
  });

  it("Alerts shows a booking confirmed after verifying as recovered, and a failed errand as failed", () => {
    const alerts = homeAlerts(
      [],
      [
        errandMoving("recovered", ["gathering", "searching", "choosing", "holding", "awaiting_approval", "executing", "verifying", "done"]),
        errandMoving("failed", ["gathering", "failed"], NOW),
        errandMoving("plain", ["gathering", "searching", "choosing", "holding", "awaiting_approval", "executing", "done"]),
      ],
    );
    expect(alerts.map((alert) => [alert.kind, alert.kind === "provider_cancelled" ? "" : alert.errand.sessionId])).toEqual([
      ["errand_failed", "failed"],
      ["booking_recovered", "recovered"],
    ]);
  });

  it("Upcoming bookings has visits from today on, plus approved ones the world hasn't confirmed, soonest first", () => {
    const visits = upcomingVisits(
      [
        booking("past", "2026-10-30T10:00:00+05:30", "completed"),
        booking("later", "2026-11-09T10:00:00+05:30"),
        booking("cancelled", "2026-11-05T10:00:00+05:30", "cancelled"),
      ],
      [proposal("checking", "verifying", "2026-11-06T10:00:00+05:30"), proposal("pending", "pending", "2026-11-05T10:00:00+05:30")],
      NOW,
    );
    expect(visits.map((visit) => (visit.kind === "booked" ? visit.booking.bookingId : `checking:${visit.proposal.proposalId}`))).toEqual([
      "checking:checking",
      "later",
    ]);
  });

  it("the 14-day chart counts visits per IST day from six days ago to a week ahead, without cancellations", () => {
    const activity = bookingActivity(
      [
        booking("a", "2026-11-04T10:00:00+05:30", "upcoming", 400),
        booking("b", "2026-11-04T10:00:00+05:30", "upcoming", 600),
        booking("c", "2026-10-29T10:00:00+05:30", "completed", 300),
        booking("d", "2026-11-05T10:00:00+05:30", "cancelled", 999),
        booking("e", "2026-10-28T10:00:00+05:30", "completed", 300),
      ],
      NOW,
    );
    expect(activity.today).toBe("2026-11-04");
    expect(activity.days).toHaveLength(14);
    expect(activity.days[0]).toEqual({ date: "2026-10-29", bookings: 1, bookedInr: 300 });
    expect(activity.days[6]).toEqual({ date: "2026-11-04", bookings: 2, bookedInr: 1_000 });
    expect(activity.days[7]).toEqual({ date: "2026-11-05", bookings: 0, bookedInr: 0 });
    expect(activity.days[13]?.date).toBe("2026-11-11");
  });

  it("the composer starts from usable facts only", () => {
    expect(composerDefaults([fact("area", "Koramangala", "active"), fact("budget", "1500", "active"), fact("earliest_hour", "10", "active")])).toEqual({
      area: "Koramangala",
      budgetInr: 1_500,
      earliestHour: 10,
    });
    expect(composerDefaults([])).toEqual({});
  });
});
