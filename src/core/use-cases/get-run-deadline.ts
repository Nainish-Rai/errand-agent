import { deadlineOf, type RunKey } from "../budget/run-budget";
import type { RunBudgetDependencies } from "./run-budget-session";

/** When the run's wall-clock limit runs out, in epoch ms. A run with no budget yet would start now. */
export async function getRunDeadline(deps: RunBudgetDependencies, run: RunKey): Promise<number> {
  const budget = await deps.budgets.find(run);
  if (budget === undefined) return deps.clock.now().getTime() + deps.limits.wallClockMs;
  return deadlineOf(budget);
}
