import { limitBeforeToolCalls, type RunExit, type RunKey } from "../budget/run-budget";
import { budgetOrNew, exhausted, stoppedWith, type RunBudgetDependencies } from "./run-budget-session";

// Charges the tool calls a model step asks for, all of them or none: when the budget can't cover
// the whole step, none of its calls runs and the run stops, so a step is never half done.

export type ToolCallsOutcome = { readonly kind: "admitted" } | { readonly kind: "stopped"; readonly exit: RunExit };

export function admitToolCalls(
  deps: RunBudgetDependencies,
  request: { readonly run: RunKey; readonly count: number },
): Promise<ToolCallsOutcome> {
  return deps.budgets.change<ToolCallsOutcome>(request.run, (current) => {
    const budget = budgetOrNew(current, request.run, deps);
    if (budget.exit !== undefined) return { budget, result: { kind: "stopped", exit: budget.exit } };
    if (request.count === 0) return { result: { kind: "admitted" } };
    const nowMs = deps.clock.now().getTime();
    const limit = limitBeforeToolCalls(budget, request.count, nowMs);
    if (limit !== undefined) return stoppedWith(budget, exhausted(budget, limit, nowMs));
    return { budget: { ...budget, toolCalls: budget.toolCalls + request.count }, result: { kind: "admitted" } };
  });
}
