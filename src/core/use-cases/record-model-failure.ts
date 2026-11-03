import { MAX_MODEL_FAILURES, type RunExit, type RunKey } from "../budget/run-budget";
import { budgetOrNew, stoppedWith, type RunBudgetDependencies } from "./run-budget-session";

// Counts a failed model call. The caller retries until the run has failed MAX_MODEL_FAILURES
// times; then the retries are exhausted and the run stops `failed`, with an explanation instead
// of an error.

export type ModelFailureOutcome = { readonly kind: "retry" } | { readonly kind: "stopped"; readonly exit: RunExit };

export function recordModelFailure(deps: RunBudgetDependencies, run: RunKey): Promise<ModelFailureOutcome> {
  return deps.budgets.change<ModelFailureOutcome>(run, (current) => {
    const budget = budgetOrNew(current, run, deps);
    if (budget.exit !== undefined) return { budget, result: { kind: "stopped", exit: budget.exit } };
    const failed = { ...budget, modelFailures: budget.modelFailures + 1 };
    if (failed.modelFailures < MAX_MODEL_FAILURES) return { budget: failed, result: { kind: "retry" } };
    return stoppedWith(failed, { kind: "failed", reason: "model_error" });
  });
}
