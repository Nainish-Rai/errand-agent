import type { DateRange, Hold, ServiceKind } from "../ports/provider-world";
import { startingTransition, type ErrandState, type ErrandTransition } from "./errand-workflow";

// The errand: what the person asked for, as structured fields. A correction patches the fields it
// names and leaves every other field as it was.

const SERVICE_KINDS: readonly ServiceKind[] = ["plumber", "electrician", "ac_servicing", "carpenter", "cleaner"];

/** Search can't start without these. Budget and preferences narrow the options but are never asked for. */
export const REQUIRED_FIELDS = ["service", "area", "timeWindow"] as const;

export type ErrandField = "service" | "area" | "timeWindow" | "budget" | "preferences";

export type RequiredField = (typeof REQUIRED_FIELDS)[number];

/** Whole hours of the day in IST: a slot fits when it starts at or after `from` and ends by `to`. */
export interface HourRange {
  readonly from: number;
  readonly to: number;
}

/** The days a visit may happen on, and optionally the hours of those days (e.g. mornings, 8 to 12). */
export interface TimeWindow {
  readonly dates: DateRange;
  readonly hours?: HourRange;
}

export interface Budget {
  /** The most the person will pay for the visit, inclusive. */
  readonly maxInr: number;
}

export interface ErrandDetails {
  readonly service?: ServiceKind;
  readonly area?: string;
  readonly timeWindow?: TimeWindow;
  readonly budget?: Budget;
  /** Free-text wishes such as "female technician" or "parts included". */
  readonly preferences: readonly string[];
}

/** The fields to change. An absent field is left as it is; there is no way to blank a field by accident. */
export type ErrandPatch = Partial<ErrandDetails>;

export interface Errand {
  readonly errandId: string;
  readonly sessionId: string;
  readonly details: ErrandDetails;
  readonly state: ErrandState;
  /** Every state change since the errand started, oldest first. */
  readonly transitions: readonly ErrandTransition[];
  /** The slot the world is holding for the person, from holding until the booking or a decline. */
  readonly hold?: Hold;
}

export type InvalidDetailReason =
  | "unknown_service"
  | "empty_area"
  | "dates_reversed"
  | "range_too_long"
  | "not_a_date"
  | "hours_out_of_range"
  | "hours_reversed"
  | "budget_not_positive";

export type PatchOutcome =
  | { readonly kind: "patched"; readonly details: ErrandDetails; readonly changed: readonly ErrandField[] }
  | { readonly kind: "invalid_detail"; readonly field: ErrandField; readonly reason: InvalidDetailReason };

/** The world searches at most 14 days at a time, so a longer window can't be searched. */
export const MAX_WINDOW_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1_000;

export const EMPTY_DETAILS: ErrandDetails = { preferences: [] };

function isServiceKind(value: string): value is ServiceKind {
  return (SERVICE_KINDS as readonly string[]).includes(value);
}

function dayNumber(date: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(ms) ? undefined : ms / DAY_MS;
}

function timeWindowProblem(window: TimeWindow): InvalidDetailReason | undefined {
  const from = dayNumber(window.dates.from);
  const to = dayNumber(window.dates.to);
  if (from === undefined || to === undefined) return "not_a_date";
  if (to < from) return "dates_reversed";
  if (to - from + 1 > MAX_WINDOW_DAYS) return "range_too_long";
  if (window.hours === undefined) return undefined;
  const { from: start, to: end } = window.hours;
  if (![start, end].every((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 24)) return "hours_out_of_range";
  return start < end ? undefined : "hours_reversed";
}

function problemWith(patch: ErrandPatch): { field: ErrandField; reason: InvalidDetailReason } | undefined {
  if (patch.service !== undefined && !isServiceKind(patch.service)) return { field: "service", reason: "unknown_service" };
  if (patch.area !== undefined && patch.area.trim() === "") return { field: "area", reason: "empty_area" };
  if (patch.timeWindow !== undefined) {
    const reason = timeWindowProblem(patch.timeWindow);
    if (reason !== undefined) return { field: "timeWindow", reason };
  }
  if (patch.budget !== undefined && !(Number.isFinite(patch.budget.maxInr) && patch.budget.maxInr > 0)) {
    return { field: "budget", reason: "budget_not_positive" };
  }
  return undefined;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const FIELDS: readonly ErrandField[] = ["service", "area", "timeWindow", "budget", "preferences"];

/**
 * Applies a patch: each field the patch names replaces that field, every other field is kept as it
 * was. The whole patch is refused if any field in it is invalid, so a bad value never half-applies.
 */
export function patchDetails(details: ErrandDetails, patch: ErrandPatch): PatchOutcome {
  const problem = problemWith(patch);
  if (problem !== undefined) return { kind: "invalid_detail", ...problem };
  const named = FIELDS.filter((field) => patch[field] !== undefined);
  const changed = named.filter((field) => !sameValue(patch[field], details[field]));
  const next: ErrandDetails = { ...details };
  for (const field of named) Object.assign(next, { [field]: patch[field] });
  return { kind: "patched", details: next, changed };
}

/** The required fields that are still empty, in the order they should be asked for. */
export function missingFields(details: ErrandDetails): RequiredField[] {
  return REQUIRED_FIELDS.filter((field) => details[field] === undefined);
}

export function isComplete(details: ErrandDetails): boolean {
  return missingFields(details).length === 0;
}

/** At most this many fields are asked for in one message, so a question stays short. */
export const MAX_FIELDS_PER_QUESTION = 2;

/** The fields the next clarifying question asks for: the first one or two missing, or none. */
export function fieldsToAsk(details: ErrandDetails): RequiredField[] {
  return missingFields(details).slice(0, MAX_FIELDS_PER_QUESTION);
}

/** A new, empty errand for a session, gathering details. */
export function openErrand(sessionId: string, atMs: number): Errand {
  return {
    errandId: `errand_${sessionId}`,
    sessionId,
    details: EMPTY_DETAILS,
    state: "gathering",
    transitions: [startingTransition(atMs)],
  };
}
