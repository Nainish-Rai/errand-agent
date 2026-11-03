import { outcomeEvent, outcomeOfRun, type RunEnding, type RunOutcome } from "../budget/outcome";
import type { RunKey } from "../budget/run-budget";
import { transitionTo, type TracePlace } from "../errand/errand-workflow";
import type { ErrandStore } from "../ports/errand-store";
import type { RunBudgetStore } from "../ports/run-budget-store";
import type { TraceSink } from "../ports/trace-sink";
import type { Clock } from "../ports/clock";
import { traceNewTransitions } from "./errand-session";

// Ends a run with its typed outcome: what stopped it if anything did, else where it left the
// errand. The outcome is recorded once, written to the run trace as a `run_outcome` event with its
// user-facing message, and a failed run fails its errand too.

export interface SettleRunDependencies {
  readonly budgets: RunBudgetStore;
  readonly errands: ErrandStore;
  readonly traceSink: TraceSink;
  readonly clock: Clock;
}

export interface SettleRunRequest {
  readonly run: RunKey;
  readonly place: TracePlace;
  readonly ending: RunEnding;
  /** The outcome's one user-facing message, from the agent's presenter. */
  readonly describe: (outcome: RunOutcome) => string;
}

async function failErrand(deps: SettleRunDependencies, place: TracePlace, atMs: number): Promise<void> {
  await deps.errands.change(place.sessionId, async (current) => {
    if (current === undefined) return { result: undefined };
    const failed = transitionTo(current, "failed", "run_failed", atMs);
    // A finished errand (done, cancelled, already failed) keeps its state.
    if (failed.kind === "illegal_transition") return { result: undefined };
    await traceNewTransitions(deps.traceSink, current, failed.subject, place);
    return { errand: failed.subject, result: undefined };
  });
}

export async function settleRun(deps: SettleRunDependencies, request: SettleRunRequest): Promise<RunOutcome> {
  const { run, place } = request;
  const earlier = await deps.budgets.findOutcome(run);
  if (earlier !== undefined) return earlier;

  const budget = await deps.budgets.find(run);
  const errand = await deps.errands.find(run.sessionId);
  const atMs = deps.clock.now().getTime();
  const { outcome, recorded } = await deps.budgets.settle({
    run,
    outcome: outcomeOfRun(budget?.exit, request.ending, errand),
    settledAtMs: atMs,
  });
  // Another settle got there first and has written the event.
  if (!recorded) return outcome;
  if (outcome.kind === "failed") await failErrand(deps, place, atMs);
  await deps.traceSink.record(outcomeEvent(run, outcome, request.describe(outcome), place, atMs));
  return outcome;
}
