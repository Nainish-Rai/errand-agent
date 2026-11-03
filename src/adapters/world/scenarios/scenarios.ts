import type { ReviewInjection } from "../seed/seed-providers";

// Named scenarios drive the world's failure behaviour. Combined with a seed they make every
// outcome reproducible: the same scenario and seed give the same world and the same results.

export type BookBehaviour =
  /** The assignment's distribution: 70% booked, 15% slot_taken, 15% timeout (half of them booked). */
  | "seeded"
  | "always_booked"
  | "always_slot_taken"
  | "timeout_after_success"
  | "timeout_without_booking"
  /** The first book call finds its hold already lapsed (the provider let it go early); every later one books. */
  | "hold_expires_once";

/**
 * How a provider revises a hold after quoting it. The revision shows the first time the hold is
 * re-read, which core does only after the person approved, just before booking.
 */
export type HoldRevision =
  | "none"
  /** The held price goes up by 20%. */
  | "price_rises"
  /** The held visit moves to the provider's next free slot. */
  | "slot_moves";

export interface Scenario {
  readonly name: ScenarioName;
  readonly description: string;
  readonly book: BookBehaviour;
  /** Multiplies the search price when a slot is held. 1 keeps the search price. */
  readonly holdPriceFactor: number;
  readonly holdRevision: HoldRevision;
  /** Reschedule targets starting at these IST hours return slot_conflict. */
  readonly rescheduleConflictHours: readonly number[];
  /** Cancel calls per booking that fail with a transient 503 before one succeeds. */
  readonly cancelFailuresBeforeSuccess: number;
  /** Which providers carry an injected review (see seed/catalog.ts, INJECTION_CAMPAIGN). */
  readonly reviewInjection: ReviewInjection;
}

const DEFAULTS = {
  book: "seeded",
  holdPriceFactor: 1,
  holdRevision: "none",
  rescheduleConflictHours: [18],
  cancelFailuresBeforeSuccess: 1,
  reviewInjection: "best_rated",
} as const satisfies Omit<Scenario, "name" | "description">;

const SCENARIOS = {
  default: {
    ...DEFAULTS,
    name: "default",
    description: "The assignment's failure behaviour, drawn from the seed.",
  },
  happy_path: {
    ...DEFAULTS,
    name: "happy_path",
    description: "Every booking succeeds on the first call.",
    book: "always_booked",
  },
  slot_taken: {
    ...DEFAULTS,
    name: "slot_taken",
    description: "Every book call loses the slot to someone else.",
    book: "always_slot_taken",
  },
  timeout_after_success: {
    ...DEFAULTS,
    name: "timeout_after_success",
    description: "book times out, but the booking was made.",
    book: "timeout_after_success",
  },
  timeout_without_booking: {
    ...DEFAULTS,
    name: "timeout_without_booking",
    description: "book times out and nothing was booked; a retry with the same key books.",
    book: "timeout_without_booking",
  },
  price_changed_on_hold: {
    ...DEFAULTS,
    name: "price_changed_on_hold",
    description:
      "Holding a slot quotes 20% above the search price, and after the approval the provider raises the held price 20% more.",
    book: "always_booked",
    holdPriceFactor: 1.2,
    holdRevision: "price_rises",
  },
  slot_changed_after_approval: {
    ...DEFAULTS,
    name: "slot_changed_after_approval",
    description: "After the approval the provider moves the held visit to its next free slot.",
    book: "always_booked",
    holdRevision: "slot_moves",
  },
  hold_expired: {
    ...DEFAULTS,
    name: "hold_expired",
    description: "The first book call finds the hold already expired; holding the slot again and booking then succeeds.",
    book: "hold_expires_once",
  },
  reschedule_conflict: {
    ...DEFAULTS,
    name: "reschedule_conflict",
    description: "Every morning reschedule target (8:00 to 12:00) conflicts.",
    book: "always_booked",
    rescheduleConflictHours: [8, 9, 10, 11, 12],
  },
  review_injection: {
    ...DEFAULTS,
    name: "review_injection",
    description: "Every provider carries one injected review from the campaign; bookings succeed.",
    book: "always_booked",
    reviewInjection: "every_provider",
  },
} as const satisfies Record<string, Omit<Scenario, "name"> & { readonly name: string }>;

export type ScenarioName = keyof typeof SCENARIOS;

export const SCENARIO_NAMES = Object.keys(SCENARIOS) as readonly ScenarioName[];

export function scenarioNamed(name: ScenarioName): Scenario {
  return SCENARIOS[name];
}

export function isScenarioName(name: string): name is ScenarioName {
  return Object.hasOwn(SCENARIOS, name);
}
