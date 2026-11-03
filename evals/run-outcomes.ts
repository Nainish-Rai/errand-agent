import type { ApiClient } from "@errand/client";
import { RunOutcomeKindSchema, type GetSessionTraceResponse, type RunOutcomeKind } from "@errand/contracts";

import { settledTrace } from "./session-trace";

// Reads how each run of a session ended, from the run trace: one `run_outcome` event per run,
// matched to the run's turn span by turn id. Grades the typed outcome, never the wording.

export interface TracedOutcome {
  readonly sessionId: string;
  readonly turnId: string;
  readonly kind: string;
  readonly message: string;
  readonly limit?: string;
  readonly failureReason?: string;
}

export interface TracedRun {
  readonly sessionId: string;
  readonly turnId: string;
  readonly durationMs?: number;
  /** Every outcome event written for this run: exactly one when the run ended properly. */
  readonly outcomes: readonly TracedOutcome[];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function isTypedOutcome(kind: string): kind is RunOutcomeKind {
  return RunOutcomeKindSchema.safeParse(kind).success;
}

export function outcomesOf(trace: GetSessionTraceResponse): TracedOutcome[] {
  return trace.events
    .filter((event) => event.kind === "run_outcome")
    .map((event) => {
      const limit = text(event.attributes["errand.budget.limit"]);
      const failureReason = text(event.attributes["errand.failure.reason"]);
      return {
        sessionId: event.sessionId,
        turnId: text(event.attributes["errand.turn.id"]) ?? "",
        kind: text(event.attributes["errand.outcome.kind"]) ?? "",
        message: text(event.attributes["errand.outcome.message"]) ?? "",
        ...(limit === undefined ? {} : { limit }),
        ...(failureReason === undefined ? {} : { failureReason }),
      };
    });
}

/** Each run (turn span) of the trace with the outcomes written for it, in start order. */
export function runsOf(trace: GetSessionTraceResponse): TracedRun[] {
  const outcomes = outcomesOf(trace);
  return trace.spans
    .filter((span) => span.kind === "agent")
    .map((span) => {
      const turnId = text(span.attributes["errand.turn.id"]) ?? "";
      return {
        sessionId: span.sessionId,
        turnId,
        ...(span.durationMs === undefined ? {} : { durationMs: span.durationMs }),
        outcomes: outcomes.filter((outcome) => outcome.sessionId === span.sessionId && outcome.turnId === turnId),
      };
    });
}

export async function tracedRuns(api: ApiClient, sessionId: string): Promise<TracedRun[]> {
  return runsOf(await settledTrace(api, sessionId));
}
