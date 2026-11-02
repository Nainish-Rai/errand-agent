import type { Clock } from "../../core/ports/clock";
import type {
  BookOutcome,
  Booking,
  BookingStatusOutcome,
  CancelOutcome,
  DateRange,
  GetProviderOutcome,
  Hold,
  HoldOutcome,
  ProviderDetails,
  ProviderSummary,
  ProviderWorld,
  RescheduleOutcome,
  SearchOutcome,
  SearchQuery,
  Slot,
} from "../../core/ports/provider-world";
import { AREAS, resolveArea, resolveService, SERVICES } from "./seed/catalog";
import { istDateOf, istHourOf, seededSlotsOn, seedProviders, type SeededProvider } from "./seed/seed-providers";
import { drawFor } from "./seed/seeded-random";
import type { Scenario } from "./scenarios/scenarios";

export const HOLD_LIFETIME_MS = 10 * 60 * 1_000;
export const DEV_USER_ID = "dev-user";
const MAX_SEARCH_DAYS = 14;
const MAX_SLOTS_PER_PROVIDER = 6;
const DAY_MS = 24 * 60 * 60 * 1_000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1_000;

export interface MockWorldOptions {
  readonly seed: number;
  readonly scenario: Scenario;
  readonly clock: Clock;
}

interface HoldRecord extends Hold {
  consumed: boolean;
}

/** What one idempotency key committed, so a repeat returns it instead of acting again. */
type KeyRecord =
  | { readonly operation: "book"; readonly holdId: string; readonly outcome: BookingStatusOutcome }
  | { readonly operation: "cancel"; readonly bookingId: string; readonly outcome: CancelOutcome }
  | {
      readonly operation: "reschedule";
      readonly bookingId: string;
      readonly slotStart: string;
      readonly outcome: RescheduleOutcome;
    };

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
 * seed, the scenario and the call's own identifiers. State lives in memory for the process.
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
  #nextId = 1;

  constructor(options: MockWorldOptions) {
    this.#seed = options.seed;
    this.#scenario = options.scenario;
    this.#clock = options.clock;
    this.#providers = new Map(seedProviders(options.seed).map((provider) => [provider.id, provider]));
    for (const booking of this.#seedPastBookings()) this.#bookings.set(booking.bookingId, booking);
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
    return { kind: "held", hold: visible };
  }

  async book(holdId: string, idempotencyKey: string): Promise<BookOutcome> {
    const recorded = this.#keys.get(idempotencyKey);
    if (recorded !== undefined) return this.#replayBook(recorded, holdId);

    const hold = this.#holds.get(holdId);
    if (hold === undefined || hold.consumed) return { kind: "hold_not_found" };
    if (this.#clock.now().getTime() > Date.parse(hold.expiresAt)) return { kind: "hold_expired" };

    const attempt = (this.#bookAttempts.get(idempotencyKey) ?? 0) + 1;
    this.#bookAttempts.set(idempotencyKey, attempt);
    const result = this.#drawBookResult(idempotencyKey, attempt);

    if (result === "slot_taken") {
      hold.consumed = true;
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

    this.#bookings.set(bookingId, { ...booking, status: "cancelled" });
    const outcome: CancelOutcome = { kind: "cancelled", bookingId };
    this.#keys.set(idempotencyKey, { operation: "cancel", bookingId, outcome });
    return outcome;
  }

  async reschedule(bookingId: string, newSlot: Slot, idempotencyKey: string): Promise<RescheduleOutcome> {
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
    const { about: _about, cancellationTerms: _terms, reviews: _reviews, ...summary } = provider;
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
    return held || booked;
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
