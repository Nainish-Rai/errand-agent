import { openBudget, usageOf, type BudgetLimit, type RunBudget, type RunExit, type RunKey, type RunLimits } from "../budget/run-budget";
import type { Clock } from "../ports/clock";
import type { RunBudgetStore } from "../ports/run-budget-store";

// What every run-budget use case works with: the persisted budgets, the limits a new run starts
// with, and the clock its wall-clock limit is measured on.

export interface RunBudgetDependencies {
  readonly budgets: RunBudgetStore;
  /** The limits a run gets when it starts. */
  readonly limits: RunLimits;
  /** The real time: a pinned clock must not make a run look older or younger than it is. */
  readonly clock: Clock;
}

/** The run's budget, or a fresh one starting now when the run has none yet. */
export function budgetOrNew(current: RunBudget | undefined, run: RunKey, deps: RunBudgetDependencies): RunBudget {
  return current ?? openBudget(run, deps.limits, deps.clock.now().getTime());
}

export function exhausted(budget: RunBudget, limit: BudgetLimit, nowMs: number): RunExit {
  return { kind: "budget_exhausted", limit, ...usageOf(budget, limit, nowMs) };
}

/** The budget with `exit` on record, so every later step of the run answers with the same exit. */
export function stoppedWith(budget: RunBudget, exit: RunExit): { readonly budget: RunBudget; readonly result: { readonly kind: "stopped"; readonly exit: RunExit } } {
  return { budget: { ...budget, exit }, result: { kind: "stopped", exit } };
}
