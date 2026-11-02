import type { ChatTurn, ToolCallView } from "@errand/client";
import {
  ErrandSearchOutputSchema,
  UpdateErrandOutputSchema,
  type ErrandSearchOutput,
  type ErrandView,
  type UpdateErrandOutput,
} from "@errand/contracts";

import type { ScenarioRun } from "./scenario-run";
import { settledTrace } from "./session-trace";

// Reads the errand side of a run: the errand tools' outputs, the errand as the API serves it, and
// the state transitions in the run trace. Grades state, never wording.

/** The week the evals' pinned clock (Wednesday 2026-11-04) calls "this week". */
export const THIS_WEEK = { from: "2026-11-04", to: "2026-11-10" } as const;

function outputsOf<T>(calls: readonly ToolCallView[], name: string, parse: (value: unknown) => T): T[] {
  return calls.filter((call) => call.name === name && call.output !== undefined).map((call) => parse(call.output));
}

export function updatesIn(turn: ChatTurn | undefined): UpdateErrandOutput[] {
  return outputsOf(turn?.toolCalls ?? [], "update_errand", (value) => UpdateErrandOutputSchema.parse(value));
}

export function searchesIn(turn: ChatTurn | undefined): ErrandSearchOutput[] {
  return outputsOf(turn?.toolCalls ?? [], "search_providers", (value) => ErrandSearchOutputSchema.parse(value));
}

/** The errand as the turn's last errand tool call left it. */
export function errandAfter(turn: ChatTurn | undefined): ErrandView | undefined {
  const last = (turn?.toolCalls ?? []).findLast(
    (call) => (call.name === "update_errand" || call.name === "search_providers") && call.output !== undefined,
  );
  if (last === undefined) return undefined;
  const schema = last.name === "update_errand" ? UpdateErrandOutputSchema : ErrandSearchOutputSchema;
  return schema.parse(last.output).errand;
}

/** How many questions a reply asks: its question marks. */
export function questionsIn(reply: string): number {
  return (reply.match(/\?/g) ?? []).length;
}

export interface TracedTransitions {
  /** `from → to` for each transition the errand holds, oldest first. */
  readonly inErrand: readonly string[];
  /** The same, read from the run trace's `state_transition` events. */
  readonly inTrace: readonly string[];
}

/** The errand's own history beside the trace's, so a scenario can check every transition was traced. */
export async function tracedTransitions(run: ScenarioRun): Promise<TracedTransitions> {
  const errand = await run.api.getErrand(run.sessionId);
  const trace = await settledTrace(run.api, run.sessionId);
  return {
    inErrand: (errand?.transitions ?? []).map((transition) => `${transition.from ?? "start"} → ${transition.to}`),
    inTrace: trace.events.filter((event) => event.kind === "state_transition").map((event) => event.name),
  };
}
