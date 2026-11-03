import type { RunOutcome } from "../budget/outcome";
import type { RunBudget, RunKey } from "../budget/run-budget";

export interface BudgetChange<T> {
  /** The budget to save; absent leaves the store as it was. */
  readonly budget?: RunBudget;
  readonly result: T;
}

export interface SettledRun {
  readonly run: RunKey;
  readonly outcome: RunOutcome;
  readonly settledAtMs: number;
}

/**
 * One budget per run, kept where a restart can't reset it. Changes to one run go one at a time:
 * the model may ask for several tool calls in one step, and each charges the same budget.
 */
export interface RunBudgetStore {
  find(run: RunKey): Promise<RunBudget | undefined>;
  change<T>(run: RunKey, change: (current: RunBudget | undefined) => Promise<BudgetChange<T>> | BudgetChange<T>): Promise<T>;
  /**
   * Records how the run ended, once. Returns the outcome on record: the one just written
   * (`recorded: true`), or the earlier one when the run had already settled.
   */
  settle(settled: SettledRun): Promise<{ readonly outcome: RunOutcome; readonly recorded: boolean }>;
  findOutcome(run: RunKey): Promise<RunOutcome | undefined>;
  /**
   * Runs that started (they have a budget) and never settled. At startup these are the runs the
   * last process died in the middle of: nothing else will ever give them an outcome.
   */
  unsettled(): Promise<readonly RunKey[]>;
}
