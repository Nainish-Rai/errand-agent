import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { RunKey } from "../../core/budget/run-budget";
import type { Clock } from "../../core/ports/clock";
import { admitToolCalls } from "../../core/use-cases/admit-tool-calls";
import { startModelTurn } from "../../core/use-cases/start-model-turn";
import { openDatabase } from "./database";
import { SqliteRunBudgetStore } from "./run-budget-store";

const RUN: RunKey = { sessionId: "wrun_1", turnId: "turn_1" };
const LIMITS = { modelTurns: 3, toolCalls: 5, wallClockMs: 60_000 };
const clock: Clock = { now: () => new Date(1_000) };

function databaseFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "errand-budget-")), "errand.db");
}

describe("sqlite run budget store", () => {
  it("keeps a run's counts and start across a restart, so the budget doesn't reset", async () => {
    const file = databaseFile();
    const first = openDatabase(file);
    const before = { budgets: new SqliteRunBudgetStore(first), limits: LIMITS, clock };
    await startModelTurn(before, RUN);
    await admitToolCalls(before, { run: RUN, count: 2 });
    await startModelTurn(before, RUN);
    first.close();

    const second = openDatabase(file);
    const after = { budgets: new SqliteRunBudgetStore(second), limits: LIMITS, clock: { now: () => new Date(9_000) } };
    expect(await after.budgets.find(RUN)).toEqual({
      run: RUN,
      limits: LIMITS,
      startedAtMs: 1_000,
      modelTurns: 2,
      toolCalls: 2,
      modelFailures: 0,
    });
    expect(await startModelTurn(after, RUN)).toEqual({ kind: "allowed", turn: 3 });
    expect(await startModelTurn(after, RUN)).toEqual({
      kind: "stopped",
      exit: { kind: "budget_exhausted", limit: "model_turns", used: 3, cap: 3 },
    });
    second.close();

    const third = new SqliteRunBudgetStore(openDatabase(file));
    expect((await third.find(RUN))?.exit).toEqual({ kind: "budget_exhausted", limit: "model_turns", used: 3, cap: 3 });
  });

  it("settles a run once: a second settle returns the first outcome", async () => {
    const store = new SqliteRunBudgetStore(openDatabase(":memory:"));
    expect(await store.settle({ run: RUN, outcome: { kind: "needs_user" }, settledAtMs: 5 })).toEqual({
      outcome: { kind: "needs_user" },
      recorded: true,
    });
    expect(await store.settle({ run: RUN, outcome: { kind: "completed" }, settledAtMs: 6 })).toEqual({
      outcome: { kind: "needs_user" },
      recorded: false,
    });
    expect(await store.findOutcome(RUN)).toEqual({ kind: "needs_user" });
  });

  it("lists the runs that started and never settled: what a killed process left behind", async () => {
    const store = new SqliteRunBudgetStore(openDatabase(":memory:"));
    const other: RunKey = { sessionId: "wrun_1", turnId: "turn_2" };
    const deps = { budgets: store, limits: LIMITS, clock };
    await startModelTurn(deps, RUN);
    await startModelTurn(deps, other);
    expect(await store.unsettled()).toEqual([RUN, other]);
    await store.settle({ run: RUN, outcome: { kind: "completed" }, settledAtMs: 5 });
    expect(await store.unsettled()).toEqual([other]);
  });

  it("charges concurrent tool-call requests one at a time, so two steps can't both slip under the cap", async () => {
    const deps = { budgets: new SqliteRunBudgetStore(openDatabase(":memory:")), limits: LIMITS, clock };
    await startModelTurn(deps, RUN);
    const results = await Promise.all([1, 2, 3].map(() => admitToolCalls(deps, { run: RUN, count: 2 })));
    expect(results.map((result) => result.kind)).toEqual(["admitted", "admitted", "stopped"]);
    expect((await deps.budgets.find(RUN))?.toolCalls).toBe(4);
  });
});
