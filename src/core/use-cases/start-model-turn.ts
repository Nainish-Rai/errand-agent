import { limitBeforeModelTurn, type RunExit, type RunKey } from "../budget/run-budget";
import { budgetOrNew, exhausted, stoppedWith, type RunBudgetDependencies } from "./run-budget-session";

// Charges one model call to the run, or stops the run instead. A run stops before its next model
// call when a tool threw something unexpected, when it is past its deadline, or when it has used
// all its model turns. Once stopped, it stays stopped: every later call gets the same exit.

export type ModelTurnOutcome =
  | { readonly kind: "allowed"; readonly turn: number }
  | { readonly kind: "stopped"; readonly exit: RunExit };

export function startModelTurn(deps: RunBudgetDependencies, run: RunKey): Promise<ModelTurnOutcome> {
  return deps.budgets.change<ModelTurnOutcome>(run, (current) => {
    const budget = budgetOrNew(current, run, deps);
    if (budget.exit !== undefined) return { budget, result: { kind: "stopped", exit: budget.exit } };
    if (budget.toolFailure !== undefined) {
      return stoppedWith(budget, { kind: "failed", reason: "tool_error", toolName: budget.toolFailure.toolName });
    }
    const nowMs = deps.clock.now().getTime();
    const limit = limitBeforeModelTurn(budget, nowMs);
    if (limit !== undefined) return stoppedWith(budget, exhausted(budget, limit, nowMs));
    const turn = budget.modelTurns + 1;
    return { budget: { ...budget, modelTurns: turn }, result: { kind: "allowed", turn } };
  });
}
