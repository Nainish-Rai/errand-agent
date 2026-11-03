import type { RunOutcome } from "../../core/budget/outcome";
import type { RunBudget, RunKey } from "../../core/budget/run-budget";
import type { BudgetChange, RunBudgetStore, SettledRun } from "../../core/ports/run-budget-store";
import { migrate, type Database, type Migration } from "./database";

// Run budgets in SQLite, so a restart in the middle of a run keeps its counts, its start time and
// its exit. One row per run (session and turn). The limits, the tool failure, the exit and the
// outcome are stored as JSON: they are read whole and never queried by field.

export const RUN_BUDGET_MIGRATIONS: readonly Migration[] = [
  {
    id: "0800_run_budgets",
    sql: `CREATE TABLE run_budgets (
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      limits TEXT NOT NULL,
      started_at_ms INTEGER NOT NULL,
      model_turns INTEGER NOT NULL,
      tool_calls INTEGER NOT NULL,
      model_failures INTEGER NOT NULL,
      tool_failure TEXT,
      exit TEXT,
      outcome TEXT,
      settled_at_ms INTEGER,
      PRIMARY KEY (session_id, turn_id)
    )`,
  },
];

interface BudgetRow {
  readonly session_id: string;
  readonly turn_id: string;
  readonly limits: string;
  readonly started_at_ms: number;
  readonly model_turns: number;
  readonly tool_calls: number;
  readonly model_failures: number;
  readonly tool_failure: string | null;
  readonly exit: string | null;
  readonly outcome: string | null;
}

function budgetFrom(row: BudgetRow): RunBudget {
  return {
    run: { sessionId: row.session_id, turnId: row.turn_id },
    limits: JSON.parse(row.limits) as RunBudget["limits"],
    startedAtMs: row.started_at_ms,
    modelTurns: row.model_turns,
    toolCalls: row.tool_calls,
    modelFailures: row.model_failures,
    ...(row.tool_failure === null ? {} : { toolFailure: JSON.parse(row.tool_failure) as RunBudget["toolFailure"] }),
    ...(row.exit === null ? {} : { exit: JSON.parse(row.exit) as RunBudget["exit"] }),
  };
}

function jsonOrNull(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

export class SqliteRunBudgetStore implements RunBudgetStore {
  readonly #db: Database;
  /** The tail of each run's queue of changes, so changes to one run never interleave. */
  readonly #queues = new Map<string, Promise<unknown>>();

  constructor(db: Database) {
    this.#db = db;
    migrate(db, RUN_BUDGET_MIGRATIONS);
  }

  async find(run: RunKey): Promise<RunBudget | undefined> {
    const row = this.#row(run);
    return row === undefined ? undefined : budgetFrom(row);
  }

  change<T>(run: RunKey, change: (current: RunBudget | undefined) => Promise<BudgetChange<T>> | BudgetChange<T>): Promise<T> {
    const key = `${run.sessionId}\u0000${run.turnId}`;
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const { budget, result } = await change(await this.find(run));
        if (budget !== undefined) this.#save(budget);
        return result;
      });
    this.#queues.set(key, next);
    // Drop the queue once it is idle, so a long-lived process doesn't keep one entry per run.
    void next.finally(() => {
      if (this.#queues.get(key) === next) this.#queues.delete(key);
    }).catch(() => undefined);
    return next;
  }

  async settle(settled: SettledRun): Promise<{ readonly outcome: RunOutcome; readonly recorded: boolean }> {
    const { run } = settled;
    // A run that never reached the model (it failed or was cancelled first) still gets a row.
    this.#db
      .prepare(
        `INSERT INTO run_budgets (session_id, turn_id, limits, started_at_ms, model_turns, tool_calls, model_failures)
         VALUES (?, ?, '{}', ?, 0, 0, 0) ON CONFLICT (session_id, turn_id) DO NOTHING`,
      )
      .run(run.sessionId, run.turnId, settled.settledAtMs);
    const written = this.#db
      .prepare("UPDATE run_budgets SET outcome = ?, settled_at_ms = ? WHERE session_id = ? AND turn_id = ? AND outcome IS NULL")
      .run(JSON.stringify(settled.outcome), settled.settledAtMs, run.sessionId, run.turnId);
    if (Number(written.changes) === 1) return { outcome: settled.outcome, recorded: true };
    const earlier = await this.findOutcome(run);
    if (earlier === undefined) throw new Error(`Run ${run.sessionId}/${run.turnId} has no outcome after settling.`);
    return { outcome: earlier, recorded: false };
  }

  async findOutcome(run: RunKey): Promise<RunOutcome | undefined> {
    const row = this.#row(run);
    return row?.outcome == null ? undefined : (JSON.parse(row.outcome) as RunOutcome);
  }

  async unsettled(): Promise<readonly RunKey[]> {
    const rows = this.#db
      .prepare("SELECT session_id, turn_id FROM run_budgets WHERE outcome IS NULL ORDER BY started_at_ms")
      .all() as unknown as readonly Pick<BudgetRow, "session_id" | "turn_id">[];
    return rows.map((row) => ({ sessionId: row.session_id, turnId: row.turn_id }));
  }

  #row(run: RunKey): BudgetRow | undefined {
    return this.#db
      .prepare("SELECT * FROM run_budgets WHERE session_id = ? AND turn_id = ?")
      .get(run.sessionId, run.turnId) as BudgetRow | undefined;
  }

  #save(budget: RunBudget): void {
    this.#db
      .prepare(
        `INSERT INTO run_budgets (session_id, turn_id, limits, started_at_ms, model_turns, tool_calls, model_failures, tool_failure, exit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_id, turn_id) DO UPDATE SET
           model_turns = excluded.model_turns,
           tool_calls = excluded.tool_calls,
           model_failures = excluded.model_failures,
           tool_failure = excluded.tool_failure,
           exit = excluded.exit`,
      )
      .run(
        budget.run.sessionId,
        budget.run.turnId,
        JSON.stringify(budget.limits),
        budget.startedAtMs,
        budget.modelTurns,
        budget.toolCalls,
        budget.modelFailures,
        jsonOrNull(budget.toolFailure),
        jsonOrNull(budget.exit),
      );
  }
}
