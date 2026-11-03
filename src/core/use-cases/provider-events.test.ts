import { describe, expect, it } from "vitest";

import type { Proposal } from "../approval/proposal";
import type { Errand } from "../errand/errand";
import { homeAlerts, alertsNeedingPerson } from "../home/home-summary";
import type { MemoryFact } from "../memory/memory-fact";
import type { ErrandChange, ErrandStore } from "../ports/errand-store";
import type { PersonNotifier, ProviderNotice } from "../ports/person-notifier";
import type { ProviderEventLog, ProviderEventRecord, ReceivedEvent } from "../ports/provider-event-log";
import type { Booking, ProviderWorld } from "../ports/provider-world";
import type { TraceRecord, TraceSink } from "../ports/trace-sink";
import { decideNotice, replacementDetails, type CancelledVisit, type NoticeSkipReason } from "../provider-events/provider-cancellation";
import { findErrandOptions } from "./find-errand-options";
import { handleProviderCancelled, type ProviderEventDependencies } from "./handle-provider-cancelled";
import { holdSlot } from "./hold-slot";
import type { ProposalDependencies } from "./proposal-session";

// Ticket 14 against in-memory ports: whether a provider's cancellation is worth telling the person,
// the replacement errand built from their saved preferences, and that each event is handled once.

// 2026-11-04 09:00 IST.
const NOW = Date.parse("2026-11-04T09:00:00+05:30");

function booking(id: string, start: string, status: Booking["status"], cancelledBy?: Booking["cancelledBy"]): Booking {
  return {
    bookingId: id,
    userId: "dev-user",
    providerId: "prv_ac_1",
    providerName: "Ravi Aircon Experts",
    service: "ac_servicing",
    slot: { start, end: start.replace(/T(\d\d)/, (_, hour: string) => `T${String(Number(hour) + 1).padStart(2, "0")}`) },
    priceInr: 999,
    status,
    ...(cancelledBy === undefined ? {} : { cancelledBy }),
  };
}

function fact(key: MemoryFact["key"], value: string, status: MemoryFact["status"] = "active"): MemoryFact {
  return {
    id: `fact_${key}`,
    ownerId: "local-dev:local-dev",
    key,
    value,
    source: status === "pending_confirmation" ? "inferred" : "explicit",
    status,
    evidence: { kind: "user_action", action: "seed" },
    validFromMs: NOW - 86_400_000,
  };
}

const UPCOMING_CANCELLED = booking("bkg_up", "2026-11-09T11:00:00+05:30", "cancelled", "provider");

describe("deciding whether a provider's cancellation needs a notice", () => {
  it("notifies for an upcoming visit the provider cancelled", () => {
    expect(decideNotice(UPCOMING_CANCELLED, NOW, false)).toEqual({ kind: "notify" });
  });

  it("stays quiet for a past visit, whatever the event says", () => {
    expect(decideNotice(booking("b", "2026-10-11T10:00:00+05:30", "completed"), NOW, false)).toEqual({ kind: "skip", reason: "past_booking" });
    expect(decideNotice(booking("b", "2026-11-04T08:00:00+05:30", "cancelled", "provider"), NOW, false)).toEqual({
      kind: "skip",
      reason: "past_booking",
    });
  });

  it("stays quiet when the person had already cancelled it, or another event already told them", () => {
    expect(decideNotice(booking("b", "2026-11-09T11:00:00+05:30", "cancelled", "person"), NOW, false)).toEqual({
      kind: "skip",
      reason: "already_cancelled",
    });
    expect(decideNotice(UPCOMING_CANCELLED, NOW, true)).toEqual({ kind: "skip", reason: "already_notified" });
  });

  it("believes the provider's books over the event: a booking still upcoming isn't cancelled, an unknown one isn't theirs", () => {
    expect(decideNotice(booking("b", "2026-11-09T11:00:00+05:30", "upcoming"), NOW, false)).toEqual({ kind: "skip", reason: "not_cancelled" });
    expect(decideNotice(undefined, NOW, false)).toEqual({ kind: "skip", reason: "unknown_booking" });
  });
});

describe("the replacement errand", () => {
  const visit: CancelledVisit = {
    bookingId: "bkg_up",
    providerId: "prv_ac_1",
    providerName: "Ravi",
    service: "ac_servicing",
    slot: UPCOMING_CANCELLED.slot,
    priceInr: 999,
  };

  it("uses the saved area, budget, earliest hour and wishes, over a week from the cancelled day", () => {
    const details = replacementDetails(
      visit,
      [fact("area", "HSR Layout"), fact("budget", "1500"), fact("earliest_hour", "10"), fact("preferences", "parts included, female technician")],
      "Koramangala",
      NOW,
    );
    expect(details).toEqual({
      service: "ac_servicing",
      area: "HSR Layout",
      timeWindow: { dates: { from: "2026-11-09", to: "2026-11-15" }, hours: { from: 10, to: 24 } },
      budget: { maxInr: 1_500 },
      preferences: ["parts included", "female technician"],
    });
  });

  it("without saved preferences, searches where the visit was, from today when the visit was today", () => {
    const today = { ...visit, slot: { start: "2026-11-04T18:00:00+05:30", end: "2026-11-04T19:00:00+05:30" } };
    expect(replacementDetails(today, [], "Koramangala", NOW)).toEqual({
      service: "ac_servicing",
      area: "Koramangala",
      timeWindow: { dates: { from: "2026-11-04", to: "2026-11-10" } },
      preferences: [],
    });
  });
});

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
}

/** The event log's rules, in memory: one row per event id, one notice per booking. */
class EventLog implements ProviderEventLog {
  readonly rows = new Map<string, ProviderEventRecord>();
  async receive(event: { eventId: string; bookingId: string; userId: string; atMs: number }): Promise<ReceivedEvent> {
    const known = this.rows.get(event.eventId);
    const record: ProviderEventRecord =
      known === undefined
        ? { eventId: event.eventId, bookingId: event.bookingId, userId: event.userId, receivedAtMs: event.atMs, deliveries: 1, decision: "pending" }
        : { ...known, deliveries: known.deliveries + 1 };
    this.rows.set(event.eventId, record);
    return { first: known === undefined, record };
  }
  async skip(eventId: string, reason: NoticeSkipReason) {
    const row = this.rows.get(eventId);
    if (row !== undefined) this.rows.set(eventId, { ...row, decision: "skipped", skipReason: reason });
  }
  async isBookingNotified(bookingId: string, exceptEventId: string) {
    return [...this.rows.values()].some(
      (row) => row.bookingId === bookingId && row.eventId !== exceptEventId && (row.decision === "notifying" || row.decision === "notified"),
    );
  }
  async claimNotice(eventId: string, notice: { sessionId: string; visit: CancelledVisit }) {
    const row = this.rows.get(eventId);
    if (row === undefined || (await this.isBookingNotified(row.bookingId, eventId))) return false;
    this.rows.set(eventId, { ...row, decision: "notifying", sessionId: notice.sessionId, visit: notice.visit });
    return true;
  }
  async markNotified(eventId: string, atMs: number) {
    const row = this.rows.get(eventId);
    if (row !== undefined) this.rows.set(eventId, { ...row, decision: "notified", notifiedAtMs: atMs });
  }
  async findEvent(eventId: string) {
    return this.rows.get(eventId);
  }
  async discardAll() {
    this.rows.clear();
  }
}

class Notifier implements PersonNotifier {
  readonly notices: { sessionId: string; notice: ProviderNotice }[] = [];
  readonly opened: string[] = [];
  failNextNotify = false;
  async openChat(key: string) {
    if (!this.opened.includes(key)) this.opened.push(key);
    return { sessionId: `chat:${key}` };
  }
  async notify(sessionId: string, notice: ProviderNotice) {
    if (this.failNextNotify) {
      this.failNextNotify = false;
      throw new Error("the process died before the chat took the notice");
    }
    this.notices.push({ sessionId, notice });
    return { deliveryId: `d${this.notices.length}` };
  }
}

function setup(bookings: readonly Booking[], options: { readonly bookedIn?: string; readonly facts?: readonly MemoryFact[] } = {}) {
  const world = {
    listBookings: async () => bookings,
    getProvider: async () => ({ kind: "provider_not_found" as const }),
  } as unknown as ProviderWorld;
  const proposals = {
    findProposalByBooking: async (bookingId: string) =>
      options.bookedIn === undefined ? undefined : ({ sessionId: options.bookedIn, bookingId } as unknown as Proposal),
  } as unknown as ProviderEventDependencies["proposals"];
  const deps = {
    events: new EventLog(),
    world,
    proposals,
    errands: new Errands(),
    memory: { read: async () => ({ facts: options.facts ?? [fact("area", "Koramangala")], tombstones: [] }) } as unknown as ProviderEventDependencies["memory"],
    notifier: new Notifier(),
    traceSink: new Sink(),
    worldClock: { now: () => new Date(NOW) },
    wallClock: { now: () => new Date(NOW) },
  };
  return deps;
}

const REQUEST = { eventId: "evt_1", bookingId: "bkg_up", userId: "dev-user", ownerId: "local-dev:local-dev" };

describe("handling a provider-cancelled event", () => {
  it("tells the chat that booked it once, with a replacement errand that excludes the provider", async () => {
    const deps = setup([UPCOMING_CANCELLED], { bookedIn: "ses_booked" });
    const outcome = await handleProviderCancelled(deps, REQUEST);
    expect(outcome).toMatchObject({ kind: "notified", sessionId: "ses_booked", resumed: false });
    expect(deps.notifier.notices.map(({ sessionId, notice }) => [sessionId, notice.idempotencyKey])).toEqual([
      ["ses_booked", "provider-cancelled:evt_1"],
    ]);
    const errand = deps.errands.errands.get("ses_booked");
    expect(errand?.replacing).toEqual({ bookingId: "bkg_up", providerId: "prv_ac_1", providerName: "Ravi Aircon Experts" });
    expect(errand?.details.area).toBe("Koramangala");
    expect(errand?.state).toBe("gathering");
  });

  it("a duplicate delivery changes nothing: no second notice, no second errand", async () => {
    const deps = setup([UPCOMING_CANCELLED], { bookedIn: "ses_booked" });
    await handleProviderCancelled(deps, REQUEST);
    const errand = deps.errands.errands.get("ses_booked");
    const again = await handleProviderCancelled(deps, REQUEST);
    expect(again).toEqual({ kind: "duplicate", decision: "notified", sessionId: "ses_booked" });
    expect(deps.notifier.notices).toHaveLength(1);
    expect(deps.errands.errands.get("ses_booked")).toBe(errand);
  });

  it("a second event about the same cancellation tells nobody", async () => {
    const deps = setup([UPCOMING_CANCELLED], { bookedIn: "ses_booked" });
    await handleProviderCancelled(deps, REQUEST);
    expect(await handleProviderCancelled(deps, { ...REQUEST, eventId: "evt_2" })).toEqual({ kind: "skipped", reason: "already_notified" });
    expect(deps.notifier.notices).toHaveLength(1);
  });

  it("a past booking gets no notice, no chat and no errand", async () => {
    const deps = setup([booking("bkg_up", "2026-10-11T10:00:00+05:30", "completed")]);
    expect(await handleProviderCancelled(deps, REQUEST)).toEqual({ kind: "skipped", reason: "past_booking" });
    expect([deps.notifier.notices.length, deps.notifier.opened.length, deps.errands.errands.size]).toEqual([0, 0, 0]);
    expect(await handleProviderCancelled(deps, REQUEST)).toEqual({ kind: "duplicate", decision: "skipped", skipReason: "past_booking" });
  });

  it("a booking made outside any chat gets a new chat of its own, the same one however often it is asked for", async () => {
    const deps = setup([UPCOMING_CANCELLED]);
    const outcome = await handleProviderCancelled(deps, REQUEST);
    expect(outcome).toMatchObject({ kind: "notified", sessionId: "chat:provider-cancelled:evt_1" });
    expect(deps.notifier.opened).toEqual(["provider-cancelled:evt_1"]);
  });

  it("a chat busy with another errand isn't taken over: the notice opens a new chat", async () => {
    const deps = setup([UPCOMING_CANCELLED], { bookedIn: "ses_busy" });
    deps.errands.errands.set("ses_busy", { errandId: "e", sessionId: "ses_busy", details: { preferences: [] }, state: "choosing", transitions: [] });
    const outcome = await handleProviderCancelled(deps, REQUEST);
    expect(outcome).toMatchObject({ kind: "notified", sessionId: "chat:provider-cancelled:evt_1" });
    expect(deps.errands.errands.get("ses_busy")?.state).toBe("choosing");
  });

  it("a notice cut short by a crash is finished by the redelivery, with the same key", async () => {
    const deps = setup([UPCOMING_CANCELLED], { bookedIn: "ses_booked" });
    deps.notifier.failNextNotify = true;
    await expect(handleProviderCancelled(deps, REQUEST)).rejects.toThrow();
    const resumed = await handleProviderCancelled(deps, REQUEST);
    expect(resumed).toMatchObject({ kind: "notified", sessionId: "ses_booked", resumed: true });
    expect(deps.notifier.notices.map(({ notice }) => notice.idempotencyKey)).toEqual(["provider-cancelled:evt_1"]);
  });

  it("the alert counts on the bell until a replacement is booked in its chat", () => {
    const alert = {
      kind: "provider_cancelled" as const,
      alertId: "alert_evt_1",
      bookingId: "bkg_up",
      providerName: "Ravi",
      service: "ac_servicing" as const,
      slot: UPCOMING_CANCELLED.slot,
      raisedAtMs: NOW,
      sessionId: "ses_booked",
    };
    const card = (status: Proposal["status"]) => ({ proposalId: "prp_new", sessionId: "ses_booked", createdAtMs: NOW + 1, status }) as Proposal;
    const waiting = homeAlerts([alert], [], [card("pending")]);
    expect(waiting[0]).toMatchObject({ replacement: { ready: 1, proposalId: "prp_new", rebooked: false } });
    expect(alertsNeedingPerson(waiting)).toBe(1);
    const rebooked = homeAlerts([alert], [], [card("executed")]);
    expect(rebooked[0]).toMatchObject({ replacement: { ready: 0, rebooked: true } });
    expect(alertsNeedingPerson(rebooked)).toBe(0);
  });
});

describe("a replacement errand never offers the provider who cancelled", () => {
  const catalog = {
    services: () => ["ac_servicing" as const],
    areas: () => ["Koramangala"],
    resolveService: (text: string) => (text === "ac_servicing" ? ("ac_servicing" as const) : undefined),
    resolveArea: (text: string) => (text === "Koramangala" ? "Koramangala" : undefined),
  };
  const slot = { start: "2026-11-09T11:00:00+05:30", end: "2026-11-09T12:00:00+05:30" };
  const provider = (id: string, priceInr: number) => ({
    id,
    name: id,
    service: "ac_servicing" as const,
    area: "Koramangala",
    priceInr,
    rating: 4.5,
    reviewCount: 10,
    freeSlots: [slot],
    attributes: [],
  });
  const replacing: Errand = {
    errandId: "e",
    sessionId: "s",
    details: { service: "ac_servicing", area: "Koramangala", timeWindow: { dates: { from: "2026-11-09", to: "2026-11-15" } }, preferences: [] },
    state: "gathering",
    transitions: [],
    replacing: { bookingId: "bkg_up", providerId: "prv_ac_1", providerName: "Ravi" },
  };

  function errandDeps() {
    const errands = new Errands();
    errands.errands.set("s", replacing);
    const world = {
      searchProviders: async () => ({ kind: "found" as const, providers: [provider("prv_ac_1", 500), provider("prv_ac_2", 900), provider("prv_ac_3", 950)] }),
      holdSlot: async () => {
        throw new Error("an excluded provider's slot must never be held");
      },
    } as unknown as ProviderWorld;
    return { errands, catalog, traceSink: new Sink(), clock: { now: () => new Date(NOW) }, world };
  }

  it("search leaves the cancelling provider out of every option, even when it would be the cheapest", async () => {
    const deps = errandDeps();
    const outcome = await findErrandOptions(deps, {
      place: { traceId: "s", sessionId: "s" },
      search: { service: "ac_servicing", area: "Koramangala", dates: { from: "2026-11-09", to: "2026-11-15" } },
    });
    expect(outcome.kind).toBe("options");
    if (outcome.kind !== "options") return;
    expect(outcome.selection.options.map((option) => option.provider.id).sort()).toEqual(["prv_ac_2", "prv_ac_3"]);
  });

  it("holding its slot is refused, whatever the model asks", async () => {
    const deps = errandDeps();
    deps.errands.errands.set("s", { ...replacing, state: "choosing" });
    const outcome = await holdSlot({ errand: deps, world: deps.world } as unknown as ProposalDependencies, {
      place: { traceId: "s", sessionId: "s" },
      providerId: "prv_ac_1",
      slot,
    });
    expect(outcome).toMatchObject({ kind: "provider_excluded", providerName: "Ravi" });
  });
});
