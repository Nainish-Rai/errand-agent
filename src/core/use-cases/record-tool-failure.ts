import type { RunKey, ToolFailure } from "../budget/run-budget";
import { budgetOrNew, type RunBudgetDependencies } from "./run-budget-session";

// A tool threw. Expected failures are values, so a throw is a bug or a fault nobody planned for:
// the run must not carry on as if the call had done its job. The next model call stops the run
// `failed` instead of letting the model try something else with the world in an unknown state.

export type ToolFailureOutcome = { readonly kind: "recorded" } | { readonly kind: "already_recorded" };

export function recordToolFailure(
  deps: RunBudgetDependencies,
  request: { readonly run: RunKey; readonly failure: ToolFailure },
): Promise<ToolFailureOutcome> {
  return deps.budgets.change<ToolFailureOutcome>(request.run, (current) => {
    const budget = budgetOrNew(current, request.run, deps);
    // The first failure explains the run; a second one in the same step adds nothing.
    if (budget.toolFailure !== undefined) return { result: { kind: "already_recorded" } };
    return { budget: { ...budget, toolFailure: request.failure }, result: { kind: "recorded" } };
  });
}
