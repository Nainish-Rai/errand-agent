import { missingFields, type Errand } from "../errand/errand";
import type { TracePlace } from "../errand/errand-workflow";
import type { TraceEvent } from "../ports/trace-sink";
import type { RunExit, RunKey } from "./run-budget";

// How a run ended. Every run ends in exactly one of these, and each has exactly one user-facing
// message, written by the agent's run-outcome presenter.

export type RunOutcomeKind = "completed" | "needs_user" | "verifying" | "budget_exhausted" | "failed";

export const RUN_OUTCOME_KINDS: readonly RunOutcomeKind[] = [
  "completed",
  "needs_user",
  "verifying",
  "budget_exhausted",
  "failed",
];

export type RunOutcome =
  /** The run did what was asked and nothing waits on anyone. */
  | { readonly kind: "completed" }
  /** The person has to answer, choose or approve before anything else happens. */
  | { readonly kind: "needs_user" }
  /** A booking's result is still unknown and is being checked. */
  | { readonly kind: "verifying" }
  /** The system stopped the run: `budget_exhausted` or `failed` (see run-budget.ts). */
  | RunExit;

/** How eve says the turn ended. */
export type RunEnding = "completed" | "failed" | "cancelled";

/** States where the next move is the person's: a question, a choice or an approval. */
const WAITING_ON_PERSON = ["choosing", "holding", "awaiting_approval"] as const;

/** The outcome of a run that ended on its own, read from where it left the errand. */
export function outcomeOfFinishedRun(errand: Errand | undefined): RunOutcome {
  if (errand === undefined) return { kind: "completed" };
  if (errand.state === "verifying") return { kind: "verifying" };
  if ((WAITING_ON_PERSON as readonly string[]).includes(errand.state)) return { kind: "needs_user" };
  if (errand.state === "gathering" && missingFields(errand.details).length > 0) return { kind: "needs_user" };
  return { kind: "completed" };
}

/** The outcome of a run, from what stopped it (if anything did), how eve ended it and the errand. */
export function outcomeOfRun(exit: RunExit | undefined, ending: RunEnding, errand: Errand | undefined): RunOutcome {
  if (exit !== undefined) return exit;
  switch (ending) {
    case "failed":
      return { kind: "failed", reason: "run_error" };
    // Stopped by the person: the run hands back to them.
    case "cancelled":
      return { kind: "needs_user" };
    case "completed":
      return outcomeOfFinishedRun(errand);
  }
}

export function isRunOutcomeKind(value: unknown): value is RunOutcomeKind {
  return typeof value === "string" && (RUN_OUTCOME_KINDS as readonly string[]).includes(value);
}

/** The outcome as a `run_outcome` event of the run trace. One per run: the event id is the run's. */
export function outcomeEvent(run: RunKey, outcome: RunOutcome, message: string, place: TracePlace, atMs: number): TraceEvent {
  return {
    type: "event",
    traceId: place.traceId,
    eventId: `${run.sessionId}:${run.turnId}:outcome`,
    sessionId: run.sessionId,
    ...(place.spanId === undefined ? {} : { spanId: place.spanId }),
    kind: "run_outcome",
    name: `run ${outcome.kind}`,
    timeMs: atMs,
    attributes: {
      "errand.turn.id": run.turnId,
      "errand.outcome.kind": outcome.kind,
      "errand.outcome.message": message,
      ...(outcome.kind === "budget_exhausted"
        ? { "errand.budget.limit": outcome.limit, "errand.budget.used": outcome.used, "errand.budget.cap": outcome.cap }
        : {}),
      ...(outcome.kind === "failed"
        ? { "errand.failure.reason": outcome.reason, ...(outcome.toolName === undefined ? {} : { "gen_ai.tool.name": outcome.toolName }) }
        : {}),
    },
  };
}
