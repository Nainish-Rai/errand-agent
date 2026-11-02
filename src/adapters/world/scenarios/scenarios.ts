// Named scenarios drive the world's failure behaviour. Combined with a seed they make every
// outcome reproducible: the same scenario and seed give the same world and the same results.

export type BookBehaviour =
  /** The assignment's distribution: 70% booked, 15% slot_taken, 15% timeout (half of them booked). */
  | "seeded"
  | "always_booked"
  | "always_slot_taken"
  | "timeout_after_success"
  | "timeout_without_booking";

export interface Scenario {
  readonly name: ScenarioName;
  readonly description: string;
  readonly book: BookBehaviour;
  /** Multiplies the search price when a slot is held. 1 keeps the search price. */
  readonly holdPriceFactor: number;
  /** Reschedule targets starting at these IST hours return slot_conflict. */
  readonly rescheduleConflictHours: readonly number[];
  /** Cancel calls per booking that fail with a transient 503 before one succeeds. */
  readonly cancelFailuresBeforeSuccess: number;
}

const DEFAULTS = {
  book: "seeded",
  holdPriceFactor: 1,
  rescheduleConflictHours: [18],
  cancelFailuresBeforeSuccess: 1,
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
    description: "Holding a slot quotes 20% above the search price.",
    book: "always_booked",
    holdPriceFactor: 1.2,
  },
  reschedule_conflict: {
    ...DEFAULTS,
    name: "reschedule_conflict",
    description: "Every morning reschedule target (8:00 to 12:00) conflicts.",
    book: "always_booked",
    rescheduleConflictHours: [8, 9, 10, 11, 12],
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
