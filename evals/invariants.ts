import type { ActionIntentView, BookingView } from "@errand/contracts";
import type { EveEvalContext } from "eve/evals";
import { equals } from "eve/evals/expect";

import { isTypedOutcome, tracedRuns } from "./run-outcomes";
import { bookingChanges, executionsIn, expectedChangeFingerprint, fingerprintOfBooking } from "./approval-checks";
import { factsLeakedIntoContext } from "./context-checks";
import { factsNotFromTheUser, memoryWritesFromToolOutput } from "./memory-checks";
import { generatedUiIsAllowed, generatedUiMatchesWorld } from "./generated-ui-checks";
import type { ScenarioRun } from "./scenario-run";

// The global invariants from SPEC.md "Testing Decisions", checked after every scenario in every
// mode. Each one turns real in the ticket that builds its feature: give it a `check` there. Until
// then it is recorded as pending, with no pass rule, so it never counts as passing.

export interface InvariantVerdict {
  readonly holds: boolean;
  /** What broke it, for the eval table's notes. */
  readonly detail?: string;
}

export interface Invariant {
  readonly id: string;
  readonly statement: string;
  /** The ticket that makes the check real. */
  readonly realIn: string;
  /** Reads world state, the ledger and the logs through the client. Absent while pending. */
  readonly check?: (run: ScenarioRun) => Promise<InvariantVerdict>;
}

/**
 * Every run in the session's trace has exactly one `run_outcome` event, of one of the five typed
 * kinds, with a message for the person. Counting the trace's turns against the conversation's
 * keeps a trace that lost a run from passing by having nothing to check.
 */
async function everyRunEndsWithATypedOutcome(run: ScenarioRun): Promise<InvariantVerdict> {
  // A scenario can span several sessions (a returning user); every one of their runs must end typed.
  const runs = (await Promise.all(run.sessionIds.map((sessionId) => tracedRuns(run.api, sessionId)))).flat();
  if (runs.length < run.turns.length) {
    return { holds: false, detail: `${run.turns.length} turns but ${runs.length} runs in the trace` };
  }
  for (const traced of runs) {
    const [outcome, ...extra] = traced.outcomes;
    if (outcome === undefined) return { holds: false, detail: `run ${traced.turnId} has no outcome` };
    if (extra.length > 0) return { holds: false, detail: `run ${traced.turnId} has ${traced.outcomes.length} outcomes` };
    if (!isTypedOutcome(outcome.kind)) return { holds: false, detail: `run ${traced.turnId} ended "${outcome.kind}"` };
    if (outcome.message.trim() === "") return { holds: false, detail: `run ${traced.turnId} has no message` };
  }
  return { holds: true };
}

function holds(problems: readonly string[]): InvariantVerdict {
  return problems.length === 0 ? { holds: true } : { holds: false, detail: problems.join("; ") };
}

/**
 * What a cancel or reschedule the world carried out needs: an approved change of that kind on the
 * booking whose grant was consumed, whose fingerprint is the one the world's change implies
 * (recomputed here from the booking's provider and ID, the slot the world now has, and the fee or
 * price the card showed), and a confirmed ledger intent for that grant naming the booking.
 */
function changeProblems(booking: BookingView, was: BookingView | undefined, intents: readonly ActionIntentView[]): string[] {
  const cancelled = booking.status === "cancelled" && was?.status !== "cancelled";
  const moved = was !== undefined && was.slot.start !== booking.slot.start;
  const wanted: readonly ("cancel" | "reschedule")[] = [...(cancelled ? ["cancel" as const] : []), ...(moved ? ["reschedule" as const] : [])];
  return wanted.flatMap((action) => {
    const covering = booking.changes.filter((change) => {
      if (change.action !== action || change.grantId === null || !change.grantConsumed) return false;
      const fingerprint = expectedChangeFingerprint({ action, providerId: booking.providerId, slot: booking.slot, priceInr: change.priceInr, bookingId: booking.bookingId });
      return change.grantFingerprint === fingerprint && change.proposalFingerprint === fingerprint;
    });
    if (covering.length === 0) return [`${booking.bookingId} was ${action === "cancel" ? "cancelled" : "moved"} without a consumed grant matching what was executed`];
    const confirmed = covering.some((change) =>
      intents.some((intent) => intent.grantId === change.grantId && intent.action === action && intent.state === "confirmed" && intent.targetBookingId === booking.bookingId),
    );
    return confirmed ? [] : [`${booking.bookingId}'s ${action} has no confirmed ledger intent for its grant`];
  });
}

/**
 * Every booking the run made has a consumed grant whose fingerprint is the one the world's booking
 * implies (recomputed here from the booking's provider, slot and price and the approved hold), and
 * every booking that was cancelled or moved has a consumed grant for exactly that change. A
 * provider cancelling a booking is the world's act, not the agent's, so it needs no grant (ticket 14).
 */
async function everySideEffectHasItsGrant(run: ScenarioRun): Promise<InvariantVerdict> {
  const { made, altered } = await bookingChanges(run);
  const before = new Map(run.bookingsBefore.map((booking) => [booking.bookingId, booking]));
  const problems = made.flatMap((booking) => {
    const { approval } = booking;
    if (approval === null) return [`${booking.bookingId} has no approved proposal`];
    if (approval.grantId === null || !approval.grantConsumed) return [`${booking.bookingId} has no consumed grant`];
    // A booking moved later in the run sits at its new slot; its move is checked like any other.
    if (booking.changes.some((change) => change.action === "reschedule")) return [];
    return approval.grantFingerprint === fingerprintOfBooking(booking) ? [] : [`${booking.bookingId} doesn't match its grant's fingerprint`];
  });
  // A provider cancelling a booking is the world's act, not the agent's: it needs no grant (ticket 14).
  const changed = [...altered, ...made.filter((booking) => booking.status === "cancelled")].filter(
    (booking) => !(booking.status === "cancelled" && booking.cancelledBy === "provider"),
  );
  const intents = changed.length === 0 ? [] : await run.api.listActionIntents();
  return holds([...problems, ...changed.flatMap((booking) => changeProblems(booking, before.get(booking.bookingId), intents))]);
}

/**
 * Ledger-backed: every booking the run made has exactly one confirmed intent in the action ledger,
 * for the grant that approved it and naming that booking; no grant made two bookings; and every
 * confirmed intent names a booking the world has. A booking with no intent behind it, or an intent
 * whose booking the world doesn't know, breaks it.
 */
async function oneBookingPerGrant(run: ScenarioRun): Promise<InvariantVerdict> {
  const { made } = await bookingChanges(run);
  const intents = await run.api.listActionIntents();
  const worldIds = new Set((await run.api.listBookings()).map((booking) => booking.bookingId));
  const perGrant = new Map<string, number>();
  const problems: string[] = [];
  for (const booking of made) {
    const grant = booking.approval?.grantId;
    if (grant == null) continue;
    perGrant.set(grant, (perGrant.get(grant) ?? 0) + 1);
    const confirmed = intents.filter((intent) => intent.grantId === grant && intent.state === "confirmed");
    if (confirmed.length !== 1 || confirmed[0]?.bookingId !== booking.bookingId) {
      problems.push(`${booking.bookingId} has no confirmed ledger intent for grant ${grant}`);
    }
  }
  for (const [grant, count] of perGrant) if (count > 1) problems.push(`grant ${grant} made ${count} bookings`);
  for (const intent of intents) {
    // A confirmed cancel or reschedule made no booking: it must name one the world has.
    if (intent.action !== "book") {
      if (intent.state === "confirmed" && (intent.targetBookingId === null || !worldIds.has(intent.targetBookingId))) {
        problems.push(`intent ${intent.idempotencyKey} is confirmed for ${intent.targetBookingId ?? "no booking"}, which the world doesn't have`);
      }
      continue;
    }
    if (intent.state === "confirmed" && (intent.bookingId === null || !worldIds.has(intent.bookingId))) {
      problems.push(`intent ${intent.idempotencyKey} is confirmed for ${intent.bookingId ?? "no booking"}, which the world doesn't have`);
    }
  }
  return holds(problems);
}

const BOOKING_ID = /\bbkg_[a-z0-9_]+\b/gi;

/**
 * Ledger-backed. A reply claims a booking when it says "Booked" (the presenter's word) or names a
 * booking ID the run made (naming one the person already had, to cancel or move it, claims
 * nothing new). Each claim needs, in the same turn, an execute_proposal that returned booked or
 * already_booked with a booking ID the action ledger has as confirmed (that is, the world's
 * get_booking_status gave it for the grant's key), and every booking ID it names must be one the
 * world has. A booking update the reconciler wrote for the person counts as a claim too.
 */
async function everyBookedClaimIsVerified(run: ScenarioRun): Promise<InvariantVerdict> {
  const bookings = await run.api.listBookings();
  const worldIds = new Set(bookings.map((booking) => booking.bookingId));
  // Naming a booking the person already had (to cancel or move it) claims nothing new, nor does
  // naming one the provider cancelled ("Ravi cancelled bkg_seed_3", ticket 14).
  const hadBefore = new Set(run.bookingsBefore.map((booking) => booking.bookingId));
  const providerCancelled = new Set(bookings.flatMap((booking) => (booking.cancelledBy === "provider" ? [booking.bookingId] : [])));
  const intents = await run.api.listActionIntents();
  const confirmedIds = new Set(intents.flatMap((intent) => (intent.state === "confirmed" && intent.bookingId !== null ? [intent.bookingId] : [])));
  const problems = run.turns.flatMap((turn, index) => {
    const mentioned = turn.reply.match(BOOKING_ID) ?? [];
    const unknown = mentioned.filter((id) => !worldIds.has(id));
    const named = mentioned.filter((id) => !hadBefore.has(id) && !providerCancelled.has(id));
    if (!/\bBooked\b/.test(turn.reply) && named.length === 0) return [];
    const claimed = executionsIn(turn).flatMap((output) =>
      (output.kind === "booked" || output.kind === "already_booked") && output.bookingId !== null ? [output.bookingId] : [],
    );
    const verified = claimed.filter((id) => confirmedIds.has(id));
    return [
      ...(verified.length === 0 ? [`turn ${index + 1} claims a booking with no execute_proposal the ledger confirmed`] : []),
      ...unknown.map((id) => `turn ${index + 1} names ${id}, which the world doesn't have`),
    ];
  });
  const notices = intents.flatMap((intent) => {
    if (intent.notice === null || !/\bBooked\b/.test(intent.notice)) return [];
    const named = intent.notice.match(BOOKING_ID) ?? [];
    const backed = intent.state === "confirmed" && intent.bookingId !== null && named.every((id) => id === intent.bookingId && worldIds.has(id));
    return backed ? [] : [`the booking update for ${intent.idempotencyKey} claims a booking the ledger hasn't confirmed`];
  });
  return holds([...problems, ...notices]);
}

async function generatedUiIsAllowedHolds(run: ScenarioRun): Promise<InvariantVerdict> {
  return holds(await generatedUiIsAllowed(run));
}

async function generatedUiMatchesWorldHolds(run: ScenarioRun): Promise<InvariantVerdict> {
  return holds(await generatedUiMatchesWorld(run));
}

/** The presenter's words for a change that happened. */
const CHANGE_CLAIM = /\b(Cancelled|Moved)\b/;

/**
 * Ledger-backed, ticket 10. A reply that says "Cancelled" or "Moved" (the presenter's words) needs,
 * in the same turn, an execute_proposal that returned cancelled, rescheduled or already_changed,
 * for a booking whose change the action ledger has as confirmed: the world's booking showed it.
 */
async function everyChangeClaimIsVerified(run: ScenarioRun): Promise<InvariantVerdict> {
  const intents = await run.api.listActionIntents();
  const confirmed = new Set(intents.flatMap((intent) => (intent.action !== "book" && intent.state === "confirmed" && intent.targetBookingId !== null ? [intent.targetBookingId] : [])));
  return holds(
    run.turns.flatMap((turn, index) => {
      if (!CHANGE_CLAIM.test(turn.reply)) return [];
      const changed = executionsIn(turn).flatMap((output) => {
        const terms = output.proposal?.terms;
        const done = output.kind === "cancelled" || output.kind === "rescheduled" || output.kind === "already_changed";
        return done && terms !== undefined && terms.action !== "book" ? [terms.bookingId] : [];
      });
      return changed.some((bookingId) => confirmed.has(bookingId)) ? [] : [`turn ${index + 1} says a booking was cancelled or moved with no change the ledger confirmed`];
    }),
  );
}

export const INVARIANTS: readonly Invariant[] = [
  {
    id: "no-side-effect-without-grant",
    statement: "No booking, cancel or reschedule without a consumed grant whose fingerprint matches what was executed",
    realIn: "05 (bookings), 10 (cancel and reschedule)",
    check: everySideEffectHasItsGrant,
  },
  { id: "one-booking-per-grant", statement: "At most one booking per grant", realIn: "05, ledger-backed in 07", check: oneBookingPerGrant },
  {
    id: "no-unverified-booked-claim",
    statement: 'No "booked" claim without a verified booking',
    realIn: "05, ledger-backed in 07",
    check: everyBookedClaimIsVerified,
  },
  {
    id: "no-unverified-change-claim",
    statement: 'No "cancelled" or "moved" claim without a change the booking\'s status confirmed',
    realIn: "10",
    check: everyChangeClaimIsVerified,
  },
  {
    id: "no-forgotten-fact-in-context",
    statement: "No forgotten or unconfirmed-inferred fact in any logged context",
    realIn: "12",
    check: async (run) => holds(await factsLeakedIntoContext(run)),
  },
  {
    id: "memory-only-from-the-user",
    statement: "Every memory fact written in a run comes from the user's own message or click, never from tool output",
    realIn: "11",
    check: async (run) => {
      const strangers = factsNotFromTheUser(await run.api.listMemory(), run);
      const fromTools = memoryWritesFromToolOutput(run);
      const holds = strangers.length === 0 && fromTools.stored === 0;
      return holds
        ? { holds }
        : { holds, detail: `${strangers.length} fact(s) quote words the user never said; ${fromTools.stored} stored from tool output` };
    },
  },
  {
    id: "typed-outcome",
    statement: "Every run ends with a typed outcome",
    realIn: "08",
    check: everyRunEndsWithATypedOutcome,
  },
  {
    id: "generated-ui-is-allowed",
    statement: "Every generated UI payload parses against the allowed library and carries no approval or commit action",
    realIn: "17",
    check: generatedUiIsAllowedHolds,
  },
  {
    id: "generated-ui-matches-world",
    statement: "Every price, rating, slot and status shown in a generated component equals the world's value for that ID",
    realIn: "17",
    check: generatedUiMatchesWorldHolds,
  },
];

export const INVARIANT_LABEL_PREFIX = "invariant ";

export async function checkInvariants(t: EveEvalContext, run: ScenarioRun): Promise<void> {
  for (const invariant of INVARIANTS) {
    const label = `${INVARIANT_LABEL_PREFIX}${invariant.id}`;
    if (invariant.check === undefined) {
      // A soft score with no threshold is tracked only: it can never pass or fail the eval.
      t.score({
        score: 0,
        message: `pending until ticket ${invariant.realIn}`,
        metadata: { invariant: invariant.id, status: "pending", realIn: invariant.realIn },
      }).label(label);
      continue;
    }
    const verdict = await invariant.check(run);
    t.check(verdict.holds, equals(true)).label(verdict.detail === undefined ? label : `${label}: ${verdict.detail}`);
  }
}
