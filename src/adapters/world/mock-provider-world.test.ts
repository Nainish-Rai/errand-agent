import { describe, expect, it } from "vitest";

import type { Clock } from "../../core/ports/clock";
import type { ProviderSummary, SearchOutcome } from "../../core/ports/provider-world";
import { HOLD_LIFETIME_MS, MockProviderWorld } from "./mock-provider-world";
import { PROMPT_INJECTION_REVIEW } from "./seed/catalog";
import { scenarioNamed, type ScenarioName } from "./scenarios/scenarios";

// Tuesday 2026-11-03, 08:30 IST.
const START = new Date("2026-11-03T03:00:00Z");
const THIS_WEEK = { from: "2026-11-03", to: "2026-11-09" };

class FixedClock implements Clock {
  #now: Date;
  constructor(now: Date) {
    this.#now = now;
  }
  now(): Date {
    return this.#now;
  }
  advance(ms: number): void {
    this.#now = new Date(this.#now.getTime() + ms);
  }
}

function worldFor(scenario: ScenarioName, seed = 42, clock: Clock = new FixedClock(START)) {
  return new MockProviderWorld({ seed, scenario: scenarioNamed(scenario), clock });
}

function providersOf(outcome: SearchOutcome): readonly ProviderSummary[] {
  if (outcome.kind !== "found") throw new Error(`Expected providers, got ${outcome.kind}`);
  return outcome.providers;
}

async function firstBookableSlot(world: MockProviderWorld) {
  const outcome = await world.searchProviders({ service: "plumber", area: "Koramangala", dateRange: THIS_WEEK });
  const provider = providersOf(outcome).find((candidate) => candidate.freeSlots.length > 0);
  if (provider === undefined) throw new Error("Seed has no free plumber slot this week.");
  return { provider, slot: provider.freeSlots[0]! };
}

async function heldSlot(world: MockProviderWorld) {
  const { provider, slot } = await firstBookableSlot(world);
  const outcome = await world.holdSlot(provider.id, slot);
  if (outcome.kind !== "held") throw new Error(`Expected a hold, got ${outcome.kind}`);
  return { provider, hold: outcome.hold };
}

describe("search_providers", () => {
  it("returns 3 to 8 providers with ids, prices, ratings, slots and attributes", async () => {
    const providers = providersOf(
      await worldFor("default").searchProviders({ service: "plumber", area: "Koramangala", dateRange: THIS_WEEK }),
    );
    expect(providers.length).toBeGreaterThanOrEqual(3);
    expect(providers.length).toBeLessThanOrEqual(8);
    for (const provider of providers) {
      expect(provider.id).toMatch(/^prv_plumber_koramangala_\d+$/);
      expect(provider.priceInr).toBeGreaterThan(0);
      expect(provider.rating).toBeGreaterThanOrEqual(3.6);
      expect(provider.rating).toBeLessThanOrEqual(4.9);
      expect(provider.attributes.length).toBeGreaterThan(0);
      for (const slot of provider.freeSlots) expect(slot.start >= "2026-11-03").toBe(true);
    }
    expect(providers.some((provider) => provider.freeSlots.length > 0)).toBe(true);
  });

  it("gives the same output for the same seed", async () => {
    const query = { service: "plumbing", area: "koramangala", dateRange: THIS_WEEK };
    const first = await worldFor("default", 7).searchProviders(query);
    const second = await worldFor("default", 7).searchProviders(query);
    expect(second).toEqual(first);
  });

  it("gives a different world for a different seed", async () => {
    const query = { service: "plumber", area: "Koramangala", dateRange: THIS_WEEK };
    const first = await worldFor("default", 1).searchProviders(query);
    const second = await worldFor("default", 2).searchProviders(query);
    expect(second).not.toEqual(first);
  });

  it("never offers a slot that has already started", async () => {
    const providers = providersOf(
      await worldFor("default").searchProviders({ service: "plumber", area: "Koramangala", dateRange: THIS_WEEK }),
    );
    for (const slot of providers.flatMap((provider) => provider.freeSlots)) {
      expect(Date.parse(slot.start)).toBeGreaterThan(START.getTime());
    }
  });

  it("names the known values when the service or area is unknown", async () => {
    const world = worldFor("default");
    expect((await world.searchProviders({ service: "astrologer", area: "Koramangala", dateRange: THIS_WEEK })).kind).toBe(
      "unknown_service",
    );
    expect((await world.searchProviders({ service: "plumber", area: "Mysuru", dateRange: THIS_WEEK })).kind).toBe(
      "unknown_area",
    );
  });

  it("rejects a reversed date range", async () => {
    const outcome = await worldFor("default").searchProviders({
      service: "plumber",
      area: "Koramangala",
      dateRange: { from: "2026-11-09", to: "2026-11-03" },
    });
    expect(outcome.kind).toBe("invalid_date_range");
  });
});

describe("get_provider", () => {
  it("includes at least one review that tries to steer the agent", async () => {
    const world = worldFor("default");
    const providers = providersOf(
      await world.searchProviders({ service: "plumber", area: "Koramangala", dateRange: THIS_WEEK }),
    );
    const reviews = (
      await Promise.all(providers.map(async (provider) => world.getProvider(provider.id)))
    ).flatMap((outcome) => (outcome.kind === "found" ? outcome.provider.reviews : []));
    expect(reviews.some((review) => review.text === PROMPT_INJECTION_REVIEW.text)).toBe(true);
  });

  it("reports an unknown provider", async () => {
    expect((await worldFor("default").getProvider("prv_nope")).kind).toBe("provider_not_found");
  });
});

describe("hold_slot", () => {
  it("quotes the search price, expiring in 10 minutes", async () => {
    const { provider, hold } = await heldSlot(worldFor("happy_path"));
    expect(hold.quotedPriceInr).toBe(provider.priceInr);
    expect(Date.parse(hold.expiresAt) - START.getTime()).toBe(HOLD_LIFETIME_MS);
  });

  it("can quote a different price than the search showed", async () => {
    const { provider, hold } = await heldSlot(worldFor("price_changed_on_hold"));
    expect(hold.quotedPriceInr).toBe(Math.round(provider.priceInr * 1.2));
  });

  it("refuses a slot that is already held", async () => {
    const world = worldFor("happy_path");
    const { provider, slot } = await firstBookableSlot(world);
    await world.holdSlot(provider.id, slot);
    expect((await world.holdSlot(provider.id, slot)).kind).toBe("slot_unavailable");
  });

  it("refuses a slot the provider never offered", async () => {
    const world = worldFor("happy_path");
    const { provider } = await firstBookableSlot(world);
    const slot = { start: "2026-11-04T03:00:00+05:30", end: "2026-11-04T04:00:00+05:30" };
    expect((await world.holdSlot(provider.id, slot)).kind).toBe("slot_unavailable");
  });
});

describe("release a hold (not a model tool: core calls it when a proposal is declined)", () => {
  it("frees the slot again and leaves the hold unbookable", async () => {
    const world = worldFor("happy_path");
    const { provider, slot } = await firstBookableSlot(world);
    const held = await world.holdSlot(provider.id, slot);
    if (held.kind !== "held") throw new Error(`Expected a hold, got ${held.kind}`);

    expect(await world.releaseHold(held.hold.holdId)).toEqual({ kind: "released" });
    expect((await world.book(held.hold.holdId, "key-after-release")).kind).toBe("hold_not_found");
    expect((await world.holdSlot(provider.id, slot)).kind).toBe("held");
  });

  it("reports a hold it doesn't know, or one already used", async () => {
    const world = worldFor("happy_path");
    expect(await world.releaseHold("hold_missing")).toEqual({ kind: "hold_not_found" });
    const { hold } = await heldSlot(world);
    await world.book(hold.holdId, "key-booked");
    expect(await world.releaseHold(hold.holdId)).toEqual({ kind: "hold_not_found" });
  });
});

describe("book", () => {
  it("books once per idempotency key, however often it is repeated", async () => {
    const world = worldFor("happy_path");
    const { hold } = await heldSlot(world);
    const first = await world.book(hold.holdId, "key-1");
    const second = await world.book(hold.holdId, "key-1");
    expect(first.kind).toBe("booked");
    expect(second).toEqual(first);
    expect((await world.listBookings("dev-user")).filter((booking) => booking.status === "upcoming")).toHaveLength(2);
  });

  it("treats the same key with a different hold as a conflict", async () => {
    const world = worldFor("happy_path");
    const { hold } = await heldSlot(world);
    await world.book(hold.holdId, "key-1");
    const other = await heldSlot(world);
    expect((await world.book(other.hold.holdId, "key-1")).kind).toBe("idempotency_conflict");
  });

  it("returns hold_expired once the 10 minutes have passed", async () => {
    const clock = new FixedClock(START);
    const world = worldFor("happy_path", 42, clock);
    const { hold } = await heldSlot(world);
    clock.advance(HOLD_LIFETIME_MS + 1);
    expect((await world.book(hold.holdId, "key-1")).kind).toBe("hold_expired");
  });

  it("times out after booking, and the status shows the booking", async () => {
    const world = worldFor("timeout_after_success");
    const { hold } = await heldSlot(world);
    expect((await world.book(hold.holdId, "key-1")).kind).toBe("timeout");
    const status = await world.getBookingStatus("key-1");
    expect(status.kind).toBe("booked");
    expect(await world.book(hold.holdId, "key-1")).toEqual(status);
  });

  it("times out without booking, and a retry with the same key books", async () => {
    const world = worldFor("timeout_without_booking");
    const { hold } = await heldSlot(world);
    expect((await world.book(hold.holdId, "key-1")).kind).toBe("timeout");
    expect((await world.getBookingStatus("key-1")).kind).toBe("not_found");
    expect((await world.book(hold.holdId, "key-1")).kind).toBe("booked");
  });

  it("can lose the slot, and the status records the failure", async () => {
    const world = worldFor("slot_taken");
    const { hold } = await heldSlot(world);
    expect((await world.book(hold.holdId, "key-1")).kind).toBe("slot_taken");
    expect(await world.getBookingStatus("key-1")).toEqual({ kind: "failed", reason: "slot_taken" });
  });

  it("follows the 70 / 15 / 15 split in the default scenario, the same way for the same seed", async () => {
    const counts = { booked: 0, slot_taken: 0, timeout: 0 };
    const outcomesFor = async (seed: number) => {
      const results: string[] = [];
      for (let index = 0; index < 300; index += 1) {
        const world = worldFor("default", seed);
        const { hold } = await heldSlot(world);
        results.push((await world.book(hold.holdId, `key-${index}`)).kind);
      }
      return results;
    };
    const first = await outcomesFor(5);
    expect(await outcomesFor(5)).toEqual(first);
    for (const kind of first) counts[kind as keyof typeof counts] += 1;
    expect(counts.booked / 300).toBeGreaterThan(0.6);
    expect(counts.booked / 300).toBeLessThan(0.8);
    expect(counts.slot_taken / 300).toBeGreaterThan(0.08);
    expect(counts.timeout / 300).toBeGreaterThan(0.08);
  });
});

describe("cancel", () => {
  it("fails with a transient 503 first, then cancels", async () => {
    const world = worldFor("happy_path");
    const { hold } = await heldSlot(world);
    const booked = await world.book(hold.holdId, "book-1");
    if (booked.kind !== "booked") throw new Error("Expected a booking.");
    expect((await world.cancel(booked.bookingId, "cancel-1")).kind).toBe("service_unavailable");
    expect(await world.cancel(booked.bookingId, "cancel-1")).toEqual({ kind: "cancelled", bookingId: booked.bookingId });
    expect(await world.cancel(booked.bookingId, "cancel-1")).toEqual({ kind: "cancelled", bookingId: booked.bookingId });
    const bookings = await world.listBookings("dev-user");
    expect(bookings.find((booking) => booking.bookingId === booked.bookingId)?.status).toBe("cancelled");
  });
});

describe("reschedule", () => {
  it("returns slot_conflict on the configured slots", async () => {
    const world = worldFor("reschedule_conflict");
    const [upcoming] = (await world.listBookings("dev-user")).filter((booking) => booking.status === "upcoming");
    if (upcoming === undefined) throw new Error("Seed has no upcoming booking.");
    const target = { start: "2026-11-05T09:00:00+05:30", end: "2026-11-05T10:00:00+05:30" };
    expect((await world.reschedule(upcoming.bookingId, target, "move-1")).kind).toBe("slot_conflict");
  });

  it("moves the booking to a free slot", async () => {
    const world = worldFor("default");
    const [upcoming] = (await world.listBookings("dev-user")).filter((booking) => booking.status === "upcoming");
    if (upcoming === undefined) throw new Error("Seed has no upcoming booking.");
    const provider = await world.getProvider(upcoming.providerId);
    if (provider.kind !== "found") throw new Error("Seed booking names an unknown provider.");
    const target = provider.provider.freeSlots.find((slot) => !slot.start.includes("T18:"));
    if (target === undefined) throw new Error("Provider has no free slot this week.");
    const moved = await world.reschedule(upcoming.bookingId, target, "move-1");
    expect(moved.kind).toBe("rescheduled");
    expect(await world.reschedule(upcoming.bookingId, target, "move-1")).toEqual(moved);
  });
});

describe("list_bookings", () => {
  it("lists the dev user's past and upcoming bookings", async () => {
    const bookings = await worldFor("default").listBookings("dev-user");
    expect(bookings.map((booking) => booking.status).sort()).toEqual(["completed", "completed", "upcoming"]);
    expect(await worldFor("default").listBookings("someone-else")).toEqual([]);
  });
});
