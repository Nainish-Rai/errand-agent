// The run budget: hard caps on one run (one turn of the agent answering one message). A run may
// call the model, call tools and spend wall-clock time only within its limits. The budget is
// persisted, so a restart in the middle of a run keeps counting where it stopped.

export interface RunLimits {
  /** Model calls the run may make, its last one included. */
  readonly modelTurns: number;
  readonly toolCalls: number;
  readonly wallClockMs: number;
}

/**
 * Enough for a whole booking in one run (update, search, hold, propose, execute, verify, reply,
 * with room for a retry), and short enough that a looping model is stopped within a few minutes.
 */
export const DEFAULT_RUN_LIMITS: RunLimits = { modelTurns: 16, toolCalls: 24, wallClockMs: 180_000 };

/**
 * Failed model calls a run absorbs before it gives up. The AI SDK retries a retryable provider
 * error twice, so three failures are one call and both its retries.
 */
export const MAX_MODEL_FAILURES = 3;

export type BudgetLimit = "model_turns" | "tool_calls" | "wall_clock";

export type FailureReason =
  /** A tool threw something nobody expected. */
  | "tool_error"
  /** The model kept failing after its retries. */
  | "model_error"
  /** The run itself failed outside a tool or the model. */
  | "run_error";

/** Why the system stopped a run: a limit ran out, or something failed. Both are run outcomes. */
export type RunExit =
  | { readonly kind: "budget_exhausted"; readonly limit: BudgetLimit; readonly used: number; readonly cap: number }
  | { readonly kind: "failed"; readonly reason: FailureReason; readonly toolName?: string };

/** A run is one turn of one session. */
export interface RunKey {
  readonly sessionId: string;
  readonly turnId: string;
}

/** A tool that threw: an unexpected error, never an expected outcome (those are values). */
export interface ToolFailure {
  readonly toolName: string;
  readonly errorName: string;
}

export interface RunBudget {
  readonly run: RunKey;
  /** Fixed when the run starts, so a change to the defaults never moves a run's caps mid-run. */
  readonly limits: RunLimits;
  readonly startedAtMs: number;
  readonly modelTurns: number;
  readonly toolCalls: number;
  readonly modelFailures: number;
  readonly toolFailure?: ToolFailure;
  /** Why the run was stopped, once something stopped it. The run answers with it from then on. */
  readonly exit?: RunExit;
}

export function deadlineOf(budget: RunBudget): number {
  return budget.startedAtMs + budget.limits.wallClockMs;
}

export function isPastDeadline(budget: RunBudget, nowMs: number): boolean {
  return nowMs >= deadlineOf(budget);
}

/** The limit that forbids another model call, if one does. */
export function limitBeforeModelTurn(budget: RunBudget, nowMs: number): BudgetLimit | undefined {
  if (isPastDeadline(budget, nowMs)) return "wall_clock";
  if (budget.modelTurns >= budget.limits.modelTurns) return "model_turns";
  return undefined;
}

/**
 * The limit that forbids running `count` more tool calls, if one does. A tool call is admitted
 * only when a model turn is left to read its result: on the last turn, a call would run and then
 * nobody would tell the person what it did.
 */
export function limitBeforeToolCalls(budget: RunBudget, count: number, nowMs: number): BudgetLimit | undefined {
  if (isPastDeadline(budget, nowMs)) return "wall_clock";
  if (budget.modelTurns >= budget.limits.modelTurns) return "model_turns";
  if (budget.toolCalls + count > budget.limits.toolCalls) return "tool_calls";
  return undefined;
}

/** How much of the limit the run had used when it hit it, and the cap, for the outcome. */
export function usageOf(budget: RunBudget, limit: BudgetLimit, nowMs: number): { readonly used: number; readonly cap: number } {
  switch (limit) {
    case "model_turns":
      return { used: budget.modelTurns, cap: budget.limits.modelTurns };
    case "tool_calls":
      return { used: budget.toolCalls, cap: budget.limits.toolCalls };
    case "wall_clock":
      return { used: Math.max(0, nowMs - budget.startedAtMs), cap: budget.limits.wallClockMs };
  }
}

export function openBudget(run: RunKey, limits: RunLimits, startedAtMs: number): RunBudget {
  return { run, limits, startedAtMs, modelTurns: 0, toolCalls: 0, modelFailures: 0 };
}
