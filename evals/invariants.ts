import type { EveEvalContext } from "eve/evals";
import { equals } from "eve/evals/expect";

import { isTypedOutcome, tracedRuns } from "./run-outcomes";
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
  const runs = await tracedRuns(run.api, run.sessionId);
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

export const INVARIANTS: readonly Invariant[] = [
  {
    id: "no-side-effect-without-grant",
    statement: "No booking, cancel or reschedule without a consumed grant whose fingerprint matches what was executed",
    realIn: "05 (bookings), 10 (cancel and reschedule)",
  },
  { id: "one-booking-per-grant", statement: "At most one booking per grant", realIn: "07" },
  { id: "no-unverified-booked-claim", statement: 'No "booked" claim without a verified booking', realIn: "07" },
  {
    id: "no-forgotten-fact-in-context",
    statement: "No forgotten or unconfirmed-inferred fact in any logged context",
    realIn: "12",
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
  },
  {
    id: "generated-ui-matches-world",
    statement: "Every price, rating, slot and status shown in a generated component equals the world's value for that ID",
    realIn: "17",
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
