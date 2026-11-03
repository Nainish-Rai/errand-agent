import { daysFrom, dayAfter, istDayOf } from "../calendar/ist-day";
import type { Errand } from "../errand/errand";
import { isFinished } from "../errand/errand-workflow";
import { outcomeOfFinishedRun } from "../budget/outcome";
import type { Proposal } from "../approval/proposal";
import type { MemoryFact } from "../memory/memory-fact";
import type { ProviderAlert } from "../ports/alert-feed";
import type { Booking } from "../ports/provider-world";

// The home screen's widgets, read from what the system already holds: errands and their
// workflow (Working now), proposals and inferred facts (Waiting on you), the world's bookings and
// unverified proposals (Upcoming bookings, the 14-day chart), provider alerts plus the errands the
// system recovered or failed (Alerts), and memory. Pure: the use case gathers, these decide.

/** An errand that isn't finished, with whose move it is. */
export interface ErrandAtWork {
  readonly errand: Errand;
  /** When it reached its current step. */
  readonly sinceMs: number;
  /** `person` when it waits for an answer, a choice or an approval; `agent` while the agent works. */
  readonly waitingOn: "agent" | "person";
}

export type UpcomingVisit =
  /** In the world's books, on or after today. */
  | { readonly kind: "booked"; readonly booking: Booking }
  /** Booked or not, the world hasn't said yet: never shown as booked. */
  | { readonly kind: "checking"; readonly proposal: Proposal };

/** Where the replacement for a provider's cancellation stands, read from the chat's proposals since the alert. */
export interface ReplacementProgress {
  /** Approval cards waiting for the person. */
  readonly ready: number;
  /** The newest of them, for a link that opens the chat at its card. */
  readonly proposalId?: string;
  /** A replacement was booked: the alert no longer needs the person. */
  readonly rebooked: boolean;
}

export type HomeAlert =
  | {
      readonly kind: "provider_cancelled";
      readonly alert: ProviderAlert;
      readonly atMs: number;
      readonly replacement: ReplacementProgress;
    }
  /** A booking whose outcome was unknown (verifying) and was later confirmed: a failure recovered from. */
  | { readonly kind: "booking_recovered"; readonly errand: Errand; readonly atMs: number }
  /** A run that failed took its errand with it (ticket 08's `failed` outcome). */
  | { readonly kind: "errand_failed"; readonly errand: Errand; readonly atMs: number };

export interface ActivityDay {
  readonly date: string;
  readonly bookings: number;
  readonly bookedInr: number;
}

/** Visits per day over 14 days: the last week, today and the next week. */
export interface BookingActivity {
  readonly today: string;
  readonly days: readonly ActivityDay[];
}

/** What the composer's chips start from: the person's active (explicit or confirmed) preferences. */
export interface ComposerDefaults {
  readonly area?: string;
  readonly budgetInr?: number;
  readonly earliestHour?: number;
}

/** Days shown before today in the 14-day chart; the rest are today and after. */
export const ACTIVITY_DAYS_BEFORE_TODAY = 6;
export const ACTIVITY_DAYS = 14;

function lastMoveMs(errand: Errand): number {
  return errand.transitions.at(-1)?.atMs ?? 0;
}

/** Open errands, the most recently moved first. */
export function errandsAtWork(errands: readonly Errand[]): ErrandAtWork[] {
  return errands
    .filter((errand) => !isFinished(errand.state))
    .map((errand) => ({
      errand,
      sinceMs: lastMoveMs(errand),
      waitingOn: outcomeOfFinishedRun(errand).kind === "needs_user" ? ("person" as const) : ("agent" as const),
    }))
    .sort((a, b) => b.sinceMs - a.sinceMs);
}

/** Facts that are true now: explicit or confirmed ones, and guesses still waiting for the person. */
export function currentFacts(facts: readonly MemoryFact[]): MemoryFact[] {
  return facts.filter((fact) => fact.validToMs === undefined && (fact.status === "active" || fact.status === "pending_confirmation"));
}

export function factsToConfirm(facts: readonly MemoryFact[]): MemoryFact[] {
  return currentFacts(facts).filter((fact) => fact.status === "pending_confirmation");
}

const CHECKING: readonly Proposal["status"][] = ["executing", "verifying"];

/** Upcoming visits, soonest first: booked ones from today on, and approved ones the world hasn't confirmed. */
export function upcomingVisits(bookings: readonly Booking[], proposals: readonly Proposal[], nowMs: number): UpcomingVisit[] {
  const today = istDayOf(nowMs);
  const booked: UpcomingVisit[] = bookings
    .filter((booking) => booking.status === "upcoming" && istDayOf(Date.parse(booking.slot.start)) >= today)
    .map((booking) => ({ kind: "booked", booking }));
  const bookedIds = new Set(bookings.map((booking) => booking.bookingId));
  const checking: UpcomingVisit[] = proposals
    .filter((proposal) => CHECKING.includes(proposal.status) && (proposal.bookingId === undefined || !bookedIds.has(proposal.bookingId)))
    .map((proposal) => ({ kind: "checking", proposal }));
  const startOf = (visit: UpcomingVisit) => (visit.kind === "booked" ? visit.booking.slot.start : visit.proposal.terms.slot.start);
  return [...booked, ...checking].sort((a, b) => Date.parse(startOf(a)) - Date.parse(startOf(b)));
}

/** When the errand's booking was confirmed after a spell in verifying, if it was. */
function recoveredAtMs(errand: Errand): number | undefined {
  const verifying = errand.transitions.findIndex((transition) => transition.to === "verifying");
  if (verifying === -1) return undefined;
  return errand.transitions.slice(verifying + 1).find((transition) => transition.to === "done")?.atMs;
}

const BOOKED: readonly Proposal["status"][] = ["executing", "verifying", "executed"];

/** The replacement's progress: the cards made in the alert's chat since it was raised. */
export function replacementProgress(alert: ProviderAlert, proposals: readonly Proposal[]): ReplacementProgress {
  const since = proposals
    .filter((proposal) => alert.sessionId !== undefined && proposal.sessionId === alert.sessionId && proposal.createdAtMs >= alert.raisedAtMs)
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
  const pending = since.filter((proposal) => proposal.status === "pending");
  return {
    ready: pending.length,
    ...(pending[0] === undefined ? {} : { proposalId: pending[0].proposalId }),
    rebooked: since.some((proposal) => BOOKED.includes(proposal.status)),
  };
}

/** Provider alerts, recovered bookings and failed errands, newest first. */
export function homeAlerts(providerAlerts: readonly ProviderAlert[], errands: readonly Errand[], proposals: readonly Proposal[] = []): HomeAlert[] {
  const fromProviders: HomeAlert[] = providerAlerts.map((alert) => ({
    kind: "provider_cancelled",
    alert,
    atMs: alert.raisedAtMs,
    replacement: replacementProgress(alert, proposals),
  }));
  const fromErrands = errands.flatMap((errand): HomeAlert[] => {
    if (errand.state === "failed") return [{ kind: "errand_failed", errand, atMs: lastMoveMs(errand) }];
    const recovered = recoveredAtMs(errand);
    return recovered === undefined ? [] : [{ kind: "booking_recovered", errand, atMs: recovered }];
  });
  return [...fromProviders, ...fromErrands].sort((a, b) => b.atMs - a.atMs);
}

/** True when the alert still needs the person: a recovered booking or a rebooked cancellation needs nothing. */
export function needsPerson(alert: HomeAlert): boolean {
  if (alert.kind === "booking_recovered") return false;
  return alert.kind !== "provider_cancelled" || !alert.replacement.rebooked;
}

/** Alerts that need the person (the bell's count). */
export function alertsNeedingPerson(alerts: readonly HomeAlert[]): number {
  return alerts.filter(needsPerson).length;
}

/** Visits per IST day over the 14-day window around today; cancelled bookings don't count. */
export function bookingActivity(bookings: readonly Booking[], nowMs: number): BookingActivity {
  const today = istDayOf(nowMs);
  const days = daysFrom(dayAfter(today, -ACTIVITY_DAYS_BEFORE_TODAY), ACTIVITY_DAYS).map((date) => {
    const onDay = bookings.filter((booking) => booking.status !== "cancelled" && istDayOf(Date.parse(booking.slot.start)) === date);
    return { date, bookings: onDay.length, bookedInr: onDay.reduce((sum, booking) => sum + booking.priceInr, 0) };
  });
  return { today, days };
}

/** The composer's starting chips from facts the agent may use (context selection's included set). */
export function composerDefaults(usable: readonly MemoryFact[]): ComposerDefaults {
  const valueOf = (key: MemoryFact["key"]) => usable.find((fact) => fact.key === key)?.value;
  const area = valueOf("area");
  const budget = Number(valueOf("budget"));
  const earliest = Number(valueOf("earliest_hour"));
  return {
    ...(area === undefined ? {} : { area }),
    ...(Number.isFinite(budget) && budget > 0 ? { budgetInr: budget } : {}),
    ...(valueOf("earliest_hour") !== undefined && Number.isInteger(earliest) ? { earliestHour: earliest } : {}),
  };
}
