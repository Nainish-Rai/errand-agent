import type { Clock } from "../../core/ports/clock";
import type {
  BookOutcome,
  Booking,
  BookingStatusOutcome,
  CancelOutcome,
  DateRange,
  GetHoldOutcome,
  GetProviderOutcome,
  Hold,
  HoldOutcome,
  ProviderCancelledEvent,
  ProviderDetails,
  ProviderSummary,
  ProviderWorld,
  ReleaseHoldOutcome,
  RescheduleOutcome,
  SearchOutcome,
  SearchQuery,
  ServiceOption,
  ServiceOptions,
  Slot,
} from "../../core/ports/provider-world";
import { serviceImageFor } from "./provider-images";
import { AREAS, resolveArea, resolveService, SERVICE_KINDS, SERVICE_TILES, SERVICES, type CatalogServiceOption } from "./seed/catalog";
import { istDateOf, istHourOf, seededSlotsOn, seedProviders, type SeededProvider } from "./seed/seed-providers";
import { drawFor } from "./seed/seeded-random";
import type { Scenario } from "./scenarios/scenarios";
import type { HoldRecord, KeyRecord, WorldState, WorldStateStore } from "./world-state";

export const HOLD_LIFETIME_MS = 10 * 60 * 1_000;
export const DEV_USER_ID = "dev-user";
const MAX_SEARCH_DAYS = 14;
const MAX_SLOTS_PER_PROVIDER = 6;
const DAY_MS = 24 * 60 * 60 * 1_000;
const HOUR_MS = 60 * 60 * 1_000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1_000;

/** What simulating a provider's cancellation did: the event the world emitted, or why there was none. */
export type ProviderCancellationOutcome =
  | { readonly kind: "emitted"; readonly event: ProviderCancelledEvent }
  | { readonly kind: "booking_not_found" };

export interface MockWorldOptions {
  readonly seed: number;
  readonly scenario: Scenario;
  readonly clock: Clock;
  /**
   * Where the world keeps its state. A provider doesn't forget a booking because our backend
   * crashed, so every change is saved before the call returns; a restart restores it from here.
   */
  readonly store?: WorldStateStore;
  /** The state a restart restores; absent, the world starts freshly seeded. */
  readonly state?: WorldState;
}

function slotKey(providerId: string, slot: Slot): string {
  return `${providerId}|${Date.parse(slot.start)}`;
}

function istDateAt(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function datesIn(range: DateRange): string[] {
  const dates: string[] = [];
  for (let day = Date.parse(`${range.from}T00:00:00Z`); day <= Date.parse(`${range.to}T00:00:00Z`); day += DAY_MS) {
    dates.push(new Date(day).toISOString().slice(0, 10));
  }
  return dates;
}

function invalidRangeReason(range: DateRange): string | undefined {
  const isDate = (text: string) => /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text));
  if (!isDate(range.from) || !isDate(range.to)) return "Dates must be YYYY-MM-DD.";
  if (range.from > range.to) return "date_range.from must not be after date_range.to.";
  if (datesIn(range).length > MAX_SEARCH_DAYS) return `Search at most ${MAX_SEARCH_DAYS} days at a time.`;
  return undefined;
}

/**
 * The mock provider network behind the eight fixed tools. Deterministic: every draw comes from the
 * seed, the scenario and the call's own identifiers. State is saved to its store on every change
 * and restored at startup: a provider outlives our backend.
 */
export class MockProviderWorld implements ProviderWorld {
  readonly #seed: number;
  readonly #scenario: Scenario;
  readonly #clock: Clock;
  readonly #providers: ReadonlyMap<string, SeededProvider>;
  readonly #holds = new Map<string, HoldRecord>();
  readonly #bookings = new Map<string, Booking>();
  readonly #keys = new Map<string, KeyRecord>();
  readonly #bookAttempts = new Map<string, number>();
  readonly #cancelAttempts = new Map<string, number>();
  /** Slots someone else booked first (a `slot_taken`): no longer free for anyone. */
  readonly #takenSlots = new Set<string>();
  readonly #store: WorldStateStore | undefined;
  readonly #providerEvents = new Map<string, ProviderCancelledEvent>();
  #nextId = 1;
  #holdLapsed = false;

  constructor(options: MockWorldOptions) {
    this.#seed = options.seed;
    this.#scenario = options.scenario;
    this.#clock = options.clock;
    this.#store = options.store;
    this.#providers = new Map(seedProviders(options.seed, options.scenario.reviewInjection, options.scenario.images).map((provider) => [provider.id, provider]));
    if (options.state === undefined) {
      if (options.scenario.seedsBookingHistory) {
        for (const booking of this.#seedPastBookings()) this.#bookings.set(booking.bookingId, booking);
      }
      this.#saved();
    } else this.#restore(options.state);
  }

  /** Everything the world has committed, as plain data. */
  snapshot(): WorldState {
    return {
      seed: this.#seed,
      scenario: this.#scenario.name,
      nextId: this.#nextId,
      holds: [...this.#holds.values()].map((hold) => ({ ...hold })),
      bookings: [...this.#bookings.values()],
      keys: [...this.#keys],
      bookAttempts: [...this.#bookAttempts],
      cancelAttempts: [...this.#cancelAttempts],
      takenSlots: [...this.#takenSlots],
      holdLapsed: this.#holdLapsed,
      providerEvents: [...this.#providerEvents.values()],
    };
  }

  #restore(state: WorldState): void {
    this.#nextId = state.nextId;
    for (const hold of state.holds) this.#holds.set(hold.holdId, { ...hold });
    for (const booking of state.bookings) this.#bookings.set(booking.bookingId, booking);
    for (const [key, record] of state.keys) this.#keys.set(key, record);
    for (const [key, count] of state.bookAttempts) this.#bookAttempts.set(key, count);
    for (const [key, count] of state.cancelAttempts) this.#cancelAttempts.set(key, count);
    for (const slot of state.takenSlots) this.#takenSlots.add(slot);
    this.#holdLapsed = state.holdLapsed ?? false;
    for (const event of state.providerEvents ?? []) this.#providerEvents.set(event.eventId, event);
  }

  /** Commits the world's state, so the change survives a crash of the process that asked for it. */
  #saved<T>(result?: T): T {
    this.#store?.save(this.snapshot());
    return result as T;
  }

  get scenario(): Scenario {
    return this.#scenario;
  }

  get seed(): number {
    return this.#seed;
  }

  async searchProviders(query: SearchQuery): Promise<SearchOutcome> {
    const service = resolveService(query.service);
    if (service === undefined) return { kind: "unknown_service", knownServices: SERVICES };
    const area = resolveArea(query.area);
    if (area === undefined) return { kind: "unknown_area", knownAreas: AREAS };
    const reason = invalidRangeReason(query.dateRange);
    if (reason !== undefined) return { kind: "invalid_date_range", reason };

    const providers = [...this.#providers.values()]
      .filter((provider) => provider.service === service && provider.area === area)
      .map((provider) => this.#summaryOf(provider, query.dateRange));
    return { kind: "found", providers };
  }

  async getProvider(providerId: string): Promise<GetProviderOutcome> {
    const provider = this.#providers.get(providerId);
    if (provider === undefined) return { kind: "provider_not_found" };
    const today = istDateAt(this.#clock.now());
    const week = { from: today, to: istDateAt(new Date(this.#clock.now().getTime() + 6 * DAY_MS)) };
    return { kind: "found", provider: this.#detailsOf(provider, week) };
  }

  async listServiceOptions(): Promise<ServiceOptions> {
    const withImage = (option: CatalogServiceOption): ServiceOption => ({ ...option, image: serviceImageFor(option.id, option.image, this.#scenario.images) });
    return { services: SERVICE_TILES.map(withImage), kinds: SERVICE_KINDS.map(withImage) };
  }

  async listBookings(userId: string): Promise<readonly Booking[]> {
    return [...this.#bookings.values()]
      .filter((booking) => booking.userId === userId)
      .sort((a, b) => a.slot.start.localeCompare(b.slot.start));
  }

  async holdSlot(providerId: string, slot: Slot): Promise<HoldOutcome> {
    const provider = this.#providers.get(providerId);
    if (provider === undefined) return { kind: "provider_not_found" };
    if (!this.#isFree(providerId, slot)) return { kind: "slot_unavailable" };

    const hold: HoldRecord = {
      holdId: this.#newId("hold"),
      providerId,
      slot: this.#canonicalSlot(providerId, slot),
      quotedPriceInr: Math.round(provider.priceInr * this.#scenario.holdPriceFactor),
      expiresAt: new Date(this.#clock.now().getTime() + HOLD_LIFETIME_MS).toISOString(),
      consumed: false,
    };
    this.#holds.set(hold.holdId, hold);
    const { consumed: _consumed, ...visible } = hold;
    return this.#saved({ kind: "held", hold: visible });
  }

  async releaseHold(holdId: string): Promise<ReleaseHoldOutcome> {
    const hold = this.#holds.get(holdId);
    if (hold === undefined || hold.consumed) return { kind: "hold_not_found" };
    // A released hold is spent: the slot is free again and `book` can no longer use it.
    hold.consumed = true;
    return this.#saved({ kind: "released" });
  }

  async getHold(holdId: string): Promise<GetHoldOutcome> {
    const stored = this.#holds.get(holdId);
    if (stored === undefined || stored.consumed) return { kind: "hold_not_found" };
    // A revision is a change on the provider's side, so it is saved like any other.
    const hold = this.#saved(this.#revised(stored));
    const { consumed: _consumed, revised: _revised, ...visible } = hold;
    return this.#clock.now().getTime() > Date.parse(hold.expiresAt) ? { kind: "hold_expired", hold: visible } : { kind: "held", hold: visible };
  }

  async book(holdId: string, idempotencyKey: string): Promise<BookOutcome> {
    return this.#saved(this.#booked(holdId, idempotencyKey));
  }

  #booked(holdId: string, idempotencyKey: string): BookOutcome {
    const recorded = this.#keys.get(idempotencyKey);
    if (recorded !== undefined) return this.#replayBook(recorded, holdId);

    const hold = this.#holds.get(holdId);
    if (hold === undefined || hold.consumed) return { kind: "hold_not_found" };
    if (this.#scenario.book === "hold_expires_once" && !this.#holdLapsed) {
      // The provider let the hold go just before this call arrived: the slot is free again and
      // nothing was booked, so no key is recorded.
      this.#holdLapsed = true;
      this.#holds.set(holdId, { ...hold, expiresAt: new Date(this.#clock.now().getTime() - 1).toISOString() });
      return { kind: "hold_expired" };
    }
    if (this.#clock.now().getTime() > Date.parse(hold.expiresAt)) return { kind: "hold_expired" };

    const attempt = (this.#bookAttempts.get(idempotencyKey) ?? 0) + 1;
    this.#bookAttempts.set(idempotencyKey, attempt);
    const result = this.#drawBookResult(idempotencyKey, attempt);

    if (result === "slot_taken") {
      hold.consumed = true;
      // Someone else booked it: the slot is gone for everyone, so the next search won't offer it.
      this.#takenSlots.add(slotKey(hold.providerId, hold.slot));
      this.#keys.set(idempotencyKey, {
        operation: "book",
        holdId,
        outcome: { kind: "failed", reason: "slot_taken" },
      });
      return { kind: "slot_taken" };
    }
    // A timeout with no effect leaves no record: the provider never saw the request, so a retry
    // with the same key is a fresh attempt.
    if (result === "timeout_without_booking") return { kind: "timeout" };

    const booking = this.#createBooking(hold);
    this.#keys.set(idempotencyKey, {
      operation: "book",
      holdId,
      outcome: { kind: "booked", bookingId: booking.bookingId },
    });
    return result === "timeout_after_success" ? { kind: "timeout" } : { kind: "booked", bookingId: booking.bookingId };
  }

  async getBookingStatus(idempotencyKey: string): Promise<BookingStatusOutcome> {
    const recorded = this.#keys.get(idempotencyKey);
    if (recorded?.operation !== "book") return { kind: "not_found" };
    return recorded.outcome;
  }

  async cancel(bookingId: string, idempotencyKey: string): Promise<CancelOutcome> {
    return this.#saved(this.#cancelled(bookingId, idempotencyKey));
  }

  #cancelled(bookingId: string, idempotencyKey: string): CancelOutcome {
    const recorded = this.#keys.get(idempotencyKey);
    if (recorded !== undefined) {
      return recorded.operation === "cancel" && recorded.bookingId === bookingId
        ? recorded.outcome
        : { kind: "idempotency_conflict" };
    }
    const booking = this.#bookings.get(bookingId);
    if (booking === undefined || booking.status === "cancelled") return { kind: "booking_not_found" };

    const attempt = (this.#cancelAttempts.get(bookingId) ?? 0) + 1;
    this.#cancelAttempts.set(bookingId, attempt);
    if (attempt <= this.#scenario.cancelFailuresBeforeSuccess) return { kind: "service_unavailable" };

    this.#bookings.set(bookingId, { ...booking, status: "cancelled", cancelledBy: "person" });
    const outcome: CancelOutcome = { kind: "cancelled", bookingId };
    this.#keys.set(idempotencyKey, { operation: "cancel", bookingId, outcome });
    return outcome;
  }

  async reschedule(bookingId: string, newSlot: Slot, idempotencyKey: string): Promise<RescheduleOutcome> {
    return this.#saved(this.#rescheduled(bookingId, newSlot, idempotencyKey));
  }

  #rescheduled(bookingId: string, newSlot: Slot, idempotencyKey: string): RescheduleOutcome {
    const recorded = this.#keys.get(idempotencyKey);
    if (recorded !== undefined) {
      return recorded.operation === "reschedule" &&
        recorded.bookingId === bookingId &&
        recorded.slotStart === newSlot.start
        ? recorded.outcome
        : { kind: "idempotency_conflict" };
    }
    const booking = this.#bookings.get(bookingId);
    if (booking === undefined || booking.status !== "upcoming") return { kind: "booking_not_found" };
    if (
      this.#scenario.rescheduleConflictHours.includes(istHourOf(newSlot)) ||
      !this.#isFree(booking.providerId, newSlot)
    ) {
      return { kind: "slot_conflict" };
    }

    const moved: Booking = { ...booking, slot: this.#canonicalSlot(booking.providerId, newSlot) };
    this.#bookings.set(bookingId, moved);
    const outcome: RescheduleOutcome = { kind: "rescheduled", booking: moved };
    this.#keys.set(idempotencyKey, { operation: "reschedule", bookingId, slotStart: newSlot.start, outcome });
    return outcome;
  }

  /**
   * Dev only, never one of the eight tools: the provider cancels a booking and the network sends us
   * an event about it. An upcoming booking becomes cancelled by the provider; a booking that is past
   * or already cancelled is left as it is, but the event is still sent, as real networks do, and the
   * receiver decides whether it matters. Naming an event id the world already sent redelivers that
   * same event without changing anything, which is how a duplicate delivery is simulated.
   */
  simulateProviderCancellation(request: {
    readonly bookingId: string;
    readonly eventId?: string;
    readonly note?: string;
  }): ProviderCancellationOutcome {
    const sent = request.eventId === undefined ? undefined : this.#providerEvents.get(request.eventId);
    if (sent !== undefined) return { kind: "emitted", event: sent };
    const booking = this.#bookings.get(request.bookingId);
    if (booking === undefined) return { kind: "booking_not_found" };
    const now = this.#clock.now();
    if (booking.status === "upcoming" && Date.parse(booking.slot.start) > now.getTime()) {
      this.#bookings.set(booking.bookingId, { ...booking, status: "cancelled", cancelledBy: "provider" });
    }
    const event: ProviderCancelledEvent = {
      eventId: request.eventId ?? this.#newId("evt"),
      bookingId: booking.bookingId,
      providerId: booking.providerId,
      occurredAt: now.toISOString(),
      ...(request.note === undefined ? {} : { note: request.note }),
    };
    this.#providerEvents.set(event.eventId, event);
    return this.#saved({ kind: "emitted", event });
  }

  #replayBook(recorded: KeyRecord, holdId: string): BookOutcome {
    if (recorded.operation !== "book" || recorded.holdId !== holdId) return { kind: "idempotency_conflict" };
    return recorded.outcome.kind === "booked"
      ? { kind: "booked", bookingId: recorded.outcome.bookingId }
      : { kind: "slot_taken" };
  }

  #drawBookResult(
    idempotencyKey: string,
    attempt: number,
  ): "booked" | "slot_taken" | "timeout_after_success" | "timeout_without_booking" {
    switch (this.#scenario.book) {
      case "always_booked":
      case "hold_expires_once":
        return "booked";
      case "always_slot_taken":
        return "slot_taken";
      case "timeout_after_success":
        return "timeout_after_success";
      case "timeout_without_booking":
        return attempt === 1 ? "timeout_without_booking" : "booked";
      case "seeded": {
        const draw = drawFor(this.#seed, "book", idempotencyKey, attempt);
        if (draw < 0.7) return "booked";
        if (draw < 0.85) return "slot_taken";
        return draw < 0.925 ? "timeout_after_success" : "timeout_without_booking";
      }
    }
  }

  /** The hold with the scenario's revision applied, the first time it is re-read. */
  #revised(hold: HoldRecord): HoldRecord {
    if (hold.revised === true || this.#scenario.holdRevision === "none") return hold;
    const revised: HoldRecord =
      this.#scenario.holdRevision === "price_rises"
        ? { ...hold, quotedPriceInr: Math.round(hold.quotedPriceInr * 1.2), revised: true }
        : { ...hold, slot: this.#nextFreeSlotAfter(hold.providerId, hold.slot), revised: true };
    this.#holds.set(hold.holdId, revised);
    return revised;
  }

  /** The provider's next offered, free slot after `slot` within a week, or the hour after it. */
  #nextFreeSlotAfter(providerId: string, slot: Slot): Slot {
    const start = Date.parse(slot.start);
    const week = { from: istDateOf(slot), to: istDateAt(new Date(start + 6 * DAY_MS)) };
    const later = datesIn(week)
      .flatMap((date) => seededSlotsOn(this.#seed, providerId, date))
      .find((open) => Date.parse(open.start) > start && !this.#isOccupied(providerId, open));
    return later ?? { start: new Date(start + HOUR_MS).toISOString(), end: new Date(Date.parse(slot.end) + HOUR_MS).toISOString() };
  }

  #createBooking(hold: HoldRecord): Booking {
    hold.consumed = true;
    const provider = this.#providers.get(hold.providerId);
    if (provider === undefined) throw new Error(`Hold ${hold.holdId} names an unknown provider.`);
    const booking: Booking = {
      bookingId: this.#newId("bkg"),
      userId: DEV_USER_ID,
      providerId: provider.id,
      providerName: provider.name,
      service: provider.service,
      slot: hold.slot,
      priceInr: hold.quotedPriceInr,
      status: "upcoming",
    };
    this.#bookings.set(booking.bookingId, booking);
    return booking;
  }

  #summaryOf(provider: SeededProvider, range: DateRange): ProviderSummary {
    const { about: _about, cancellationTerms: _terms, cancellationPolicy: _policy, reviews: _reviews, ...summary } = provider;
    return { ...summary, freeSlots: this.#freeSlots(provider.id, range) };
  }

  #detailsOf(provider: SeededProvider, range: DateRange): ProviderDetails {
    return { ...provider, freeSlots: this.#freeSlots(provider.id, range) };
  }

  #freeSlots(providerId: string, range: DateRange): Slot[] {
    const now = this.#clock.now().getTime();
    return datesIn(range)
      .flatMap((date) => seededSlotsOn(this.#seed, providerId, date))
      .filter((slot) => Date.parse(slot.start) > now && !this.#isOccupied(providerId, slot))
      .slice(0, MAX_SLOTS_PER_PROVIDER);
  }

  #isFree(providerId: string, slot: Slot): boolean {
    const seeded = seededSlotsOn(this.#seed, providerId, istDateOf(slot));
    const offered = seeded.some((open) => Date.parse(open.start) === Date.parse(slot.start));
    return offered && Date.parse(slot.start) > this.#clock.now().getTime() && !this.#isOccupied(providerId, slot);
  }

  #isOccupied(providerId: string, slot: Slot): boolean {
    const start = Date.parse(slot.start);
    const now = this.#clock.now().getTime();
    const held = [...this.#holds.values()].some(
      (hold) =>
        hold.providerId === providerId &&
        !hold.consumed &&
        Date.parse(hold.expiresAt) >= now &&
        Date.parse(hold.slot.start) === start,
    );
    const booked = [...this.#bookings.values()].some(
      (booking) =>
        booking.providerId === providerId && booking.status === "upcoming" && Date.parse(booking.slot.start) === start,
    );
    return held || booked || this.#takenSlots.has(slotKey(providerId, slot));
  }

  #canonicalSlot(providerId: string, slot: Slot): Slot {
    const seeded = seededSlotsOn(this.#seed, providerId, istDateOf(slot));
    return seeded.find((open) => Date.parse(open.start) === Date.parse(slot.start)) ?? slot;
  }

  #newId(prefix: string): string {
    const id = `${prefix}_${String(this.#nextId).padStart(4, "0")}`;
    this.#nextId += 1;
    return id;
  }

  /** A short history for the dev user, so "the same electrician as last time" has an answer. */
  #seedPastBookings(): Booking[] {
    const now = this.#clock.now().getTime();
    const at = (daysFromNow: number, hour: number): Slot => {
      const date = istDateAt(new Date(now + daysFromNow * DAY_MS));
      const pad = (value: number) => String(value).padStart(2, "0");
      return { start: `${date}T${pad(hour)}:00:00+05:30`, end: `${date}T${pad(hour + 1)}:00:00+05:30` };
    };
    const history = [
      { providerId: "prv_electrician_koramangala_1", slot: at(-24, 10), status: "completed" as const },
      { providerId: "prv_plumber_koramangala_2", slot: at(-61, 9), status: "completed" as const },
      { providerId: "prv_ac_servicing_koramangala_1", slot: at(5, 11), status: "upcoming" as const },
    ];
    return history.flatMap(({ providerId, slot, status }, index) => {
      const provider = this.#providers.get(providerId);
      if (provider === undefined) return [];
      return [
        {
          bookingId: `bkg_seed_${index + 1}`,
          userId: DEV_USER_ID,
          providerId,
          providerName: provider.name,
          service: provider.service,
          slot,
          priceInr: provider.priceInr,
          status,
        },
      ];
    });
  }
}
