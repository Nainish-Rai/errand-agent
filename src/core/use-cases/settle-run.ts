import { outcomeEvent, outcomeOfRun, type RunEnding, type RunOutcome } from "../budget/outcome";
import type { RunKey } from "../budget/run-budget";
import { transitionTo, type ErrandState, type TracePlace } from "../errand/errand-workflow";
import { isExecutionStarted } from "../approval/proposal";
import type { Errand } from "../errand/errand";
import type { ErrandStore } from "../ports/errand-store";
import type { ProposalStore } from "../ports/proposal-store";
import type { ProviderWorld } from "../ports/provider-world";
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
  /** A failed run gives back the hold it was waiting on, so the slot isn't kept for nothing. */
  readonly world: ProviderWorld;
  readonly proposals: ProposalStore;
}

export interface SettleRunRequest {
  readonly run: RunKey;
  readonly place: TracePlace;
  readonly ending: RunEnding;
  /** The outcome's one user-facing message, from the agent's presenter. */
  readonly describe: (outcome: RunOutcome) => string;
}

/** A booking is in flight: its outcome belongs to the action ledger, not to the run that started it. */
const BOOKING_IN_FLIGHT: readonly ErrandState[] = ["executing", "verifying"];

/** States in which the errand holds a slot that nothing is booking yet. */
const HOLDING: readonly ErrandState[] = ["holding", "awaiting_approval"];

/**
 * Gives the failed errand's hold back to the world and voids the card that offered it, so the
 * slot is free again and nobody can approve a booking the errand no longer waits on.
 */
async function releaseAbandonedHold(deps: SettleRunDependencies, errand: Errand): Promise<void> {
  const { hold } = errand;
  if (hold === undefined || !HOLDING.includes(errand.state)) return;
  const latest = await deps.proposals.latestProposalOf(errand.sessionId);
  const proposal = latest?.terms.action === "book" && latest.terms.holdId === hold.holdId ? latest : undefined;
  // `book` was (or is being) sent on this hold; the ledger settles it, and releasing could undo it.
  if (proposal !== undefined && isExecutionStarted(proposal)) return;
  await deps.world.releaseHold(hold.holdId);
  if (proposal?.status === "pending" || proposal?.status === "approved") await deps.proposals.saveProposal({ ...proposal, status: "expired" });
}

async function failErrand(deps: SettleRunDependencies, place: TracePlace, atMs: number): Promise<void> {
  await deps.errands.change(place.sessionId, async (current) => {
    if (current === undefined || BOOKING_IN_FLIGHT.includes(current.state)) return { result: undefined };
    const failed = transitionTo(current, "failed", "run_failed", atMs);
    // A finished errand (done, cancelled, already failed) keeps its state.
    if (failed.kind === "illegal_transition") return { result: undefined };
    await releaseAbandonedHold(deps, current);
    const { hold: _released, ...withoutHold } = failed.subject;
    await traceNewTransitions(deps.traceSink, current, withoutHold, place);
    return { errand: withoutHold, result: undefined };
  });
}

/**
 * Runs the last process died in the middle of (a crash, a kill) never reached their end, so they
 * have no outcome. At startup, after the action ledger is reconciled, each is settled as failed: a
 * booking it left in flight belongs to the ledger and keeps its state; anything else fails.
 */
export async function settleInterruptedRuns(
  deps: SettleRunDependencies,
  request: { readonly placeOf: (run: RunKey) => TracePlace; readonly describe: SettleRunRequest["describe"] },
): Promise<readonly RunKey[]> {
  const runs = await deps.budgets.unsettled();
  for (const run of runs) await settleRun(deps, { run, place: request.placeOf(run), ending: "failed", describe: request.describe });
  return runs;
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
