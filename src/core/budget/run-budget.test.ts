import { describe, expect, it } from "vitest";

import { openErrand, type Errand } from "../errand/errand";
import { transitionTo } from "../errand/errand-workflow";
import type { Clock } from "../ports/clock";
import type { ErrandChange, ErrandStore } from "../ports/errand-store";
import type { BudgetChange, RunBudgetStore, SettledRun } from "../ports/run-budget-store";
import type { TraceRecord, TraceSink } from "../ports/trace-sink";
import { admitToolCalls } from "../use-cases/admit-tool-calls";
import { getRunDeadline } from "../use-cases/get-run-deadline";
import { recordModelFailure } from "../use-cases/record-model-failure";
import { recordToolFailure } from "../use-cases/record-tool-failure";
import type { RunBudgetDependencies } from "../use-cases/run-budget-session";
import { settleRun } from "../use-cases/settle-run";
import { startModelTurn } from "../use-cases/start-model-turn";
import { outcomeOfFinishedRun, outcomeOfRun, type RunOutcome } from "./outcome";
import type { RunBudget, RunKey, RunLimits } from "./run-budget";

// Budget exits, tested on the use cases with in-memory ports (SPEC "Seam 2").

class MemoryBudgets implements RunBudgetStore {
  readonly budgets = new Map<string, RunBudget>();
  readonly outcomes = new Map<string, RunOutcome>();

  async find(run: RunKey): Promise<RunBudget | undefined> {
    return this.budgets.get(`${run.sessionId}/${run.turnId}`);
  }

  async change<T>(run: RunKey, change: (current: RunBudget | undefined) => Promise<BudgetChange<T>> | BudgetChange<T>): Promise<T> {
    const { budget, result } = await change(await this.find(run));
    if (budget !== undefined) this.budgets.set(`${run.sessionId}/${run.turnId}`, budget);
    return result;
  }

  async settle(settled: SettledRun): Promise<{ readonly outcome: RunOutcome; readonly recorded: boolean }> {
    const key = `${settled.run.sessionId}/${settled.run.turnId}`;
    const earlier = this.outcomes.get(key);
    if (earlier !== undefined) return { outcome: earlier, recorded: false };
    this.outcomes.set(key, settled.outcome);
    return { outcome: settled.outcome, recorded: true };
  }

  async findOutcome(run: RunKey): Promise<RunOutcome | undefined> {
    return this.outcomes.get(`${run.sessionId}/${run.turnId}`);
  }
}

class MemoryErrands implements ErrandStore {
  readonly errands = new Map<string, Errand>();

  async find(sessionId: string): Promise<Errand | undefined> {
    return this.errands.get(sessionId);
  }

  async change<T>(sessionId: string, change: (current: Errand | undefined) => Promise<ErrandChange<T>>): Promise<T> {
    const { errand, result } = await change(this.errands.get(sessionId));
    if (errand !== undefined) this.errands.set(sessionId, errand);
    return result;
  }
}

class MemoryTrace implements TraceSink {
  readonly records: TraceRecord[] = [];

  async record(record: TraceRecord): Promise<void> {
    this.records.push(record);
  }

  async read(): Promise<readonly TraceRecord[]> {
    return this.records;
  }
}

class StepClock implements Clock {
  ms = 1_000_000;

  now(): Date {
    return new Date(this.ms);
  }
}

const RUN: RunKey = { sessionId: "s1", turnId: "t1" };
const LIMITS: RunLimits = { modelTurns: 3, toolCalls: 4, wallClockMs: 10_000 };

function world(limits: RunLimits = LIMITS) {
  const budgets = new MemoryBudgets();
  const clock = new StepClock();
  const deps: RunBudgetDependencies = { budgets, limits, clock };
  return { budgets, clock, deps };
}

describe("run budget", () => {
  it("allows model turns up to the cap, then stops the run budget_exhausted", async () => {
    const { deps } = world();
    for (const turn of [1, 2, 3]) expect(await startModelTurn(deps, RUN)).toEqual({ kind: "allowed", turn });
    expect(await startModelTurn(deps, RUN)).toEqual({
      kind: "stopped",
      exit: { kind: "budget_exhausted", limit: "model_turns", used: 3, cap: 3 },
    });
  });

  it("refuses tool calls on the last model turn, when no turn is left to read their results", async () => {
    const { deps } = world();
    await startModelTurn(deps, RUN);
    expect(await admitToolCalls(deps, { run: RUN, count: 1 })).toEqual({ kind: "admitted" });
    await startModelTurn(deps, RUN);
    await startModelTurn(deps, RUN);
    expect(await admitToolCalls(deps, { run: RUN, count: 1 })).toMatchObject({
      kind: "stopped",
      exit: { kind: "budget_exhausted", limit: "model_turns" },
    });
  });

  it("admits a step's tool calls all together or not at all", async () => {
    const { deps, budgets } = world({ ...LIMITS, modelTurns: 10 });
    await startModelTurn(deps, RUN);
    expect(await admitToolCalls(deps, { run: RUN, count: 3 })).toEqual({ kind: "admitted" });
    await startModelTurn(deps, RUN);
    expect(await admitToolCalls(deps, { run: RUN, count: 2 })).toEqual({
      kind: "stopped",
      exit: { kind: "budget_exhausted", limit: "tool_calls", used: 3, cap: 4 },
    });
    expect((await budgets.find(RUN))?.toolCalls).toBe(3);
  });

  it("stops the run once it is past its deadline", async () => {
    const { deps, clock } = world();
    await startModelTurn(deps, RUN);
    expect(await getRunDeadline(deps, RUN)).toBe(clock.ms + LIMITS.wallClockMs);
    clock.ms += LIMITS.wallClockMs;
    expect(await startModelTurn(deps, RUN)).toEqual({
      kind: "stopped",
      exit: { kind: "budget_exhausted", limit: "wall_clock", used: 10_000, cap: 10_000 },
    });
  });

  it("a stopped run stays stopped with the same exit, even if a limit would now allow it", async () => {
    const { deps } = world();
    await startModelTurn(deps, RUN);
    await recordToolFailure(deps, { run: RUN, failure: { toolName: "search_providers", errorName: "TypeError" } });
    const exit = { kind: "failed", reason: "tool_error", toolName: "search_providers" } as const;
    expect(await startModelTurn(deps, RUN)).toEqual({ kind: "stopped", exit });
    expect(await admitToolCalls(deps, { run: RUN, count: 0 })).toEqual({ kind: "stopped", exit });
    expect(await startModelTurn(deps, RUN)).toEqual({ kind: "stopped", exit });
  });

  it("a tool error ends the run failed at the next model call", async () => {
    const { deps } = world();
    await startModelTurn(deps, RUN);
    expect(
      await recordToolFailure(deps, { run: RUN, failure: { toolName: "search_providers", errorName: "TypeError" } }),
    ).toEqual({ kind: "recorded" });
    expect(await recordToolFailure(deps, { run: RUN, failure: { toolName: "get_errand", errorName: "Error" } })).toEqual({
      kind: "already_recorded",
    });
    expect(await startModelTurn(deps, RUN)).toEqual({
      kind: "stopped",
      exit: { kind: "failed", reason: "tool_error", toolName: "search_providers" },
    });
  });

  it("retries a failing model call twice, then ends the run failed", async () => {
    const { deps } = world();
    expect(await recordModelFailure(deps, RUN)).toEqual({ kind: "retry" });
    expect(await recordModelFailure(deps, RUN)).toEqual({ kind: "retry" });
    expect(await recordModelFailure(deps, RUN)).toEqual({ kind: "stopped", exit: { kind: "failed", reason: "model_error" } });
  });

  it("keeps the limits a run started with when the defaults change", async () => {
    const { budgets, clock } = world();
    await startModelTurn({ budgets, clock, limits: LIMITS }, RUN);
    const looser = { budgets, clock, limits: { ...LIMITS, modelTurns: 100 } };
    await startModelTurn(looser, RUN);
    await startModelTurn(looser, RUN);
    expect(await startModelTurn(looser, RUN)).toMatchObject({ kind: "stopped" });
  });
});

describe("run outcome", () => {
  const at = (state: Parameters<typeof transitionTo>[1], details = {}) => {
    const errand = openErrand("s1", 0);
    const searching = transitionTo({ ...errand, details: { ...errand.details, ...details } }, "searching", "search_started", 1);
    if (searching.kind !== "transitioned") throw new Error("setup");
    if (state === "searching") return searching.subject;
    const moved = transitionTo(searching.subject, state, "options_found", 2);
    if (moved.kind !== "transitioned") throw new Error("setup");
    return moved.subject;
  };
  const complete = { service: "plumber", area: "Koramangala", timeWindow: { dates: { from: "2026-11-04", to: "2026-11-10" } } } as const;

  it("a run that ends on its own takes its outcome from where it left the errand", () => {
    expect(outcomeOfFinishedRun(undefined)).toEqual({ kind: "completed" });
    expect(outcomeOfFinishedRun(openErrand("s1", 0))).toEqual({ kind: "needs_user" });
    expect(outcomeOfFinishedRun(at("choosing", complete))).toEqual({ kind: "needs_user" });
    expect(outcomeOfFinishedRun(at("failed", complete))).toEqual({ kind: "completed" });
  });

  it("what stopped the run wins over how eve ended it", () => {
    const exit = { kind: "budget_exhausted", limit: "tool_calls", used: 4, cap: 4 } as const;
    expect(outcomeOfRun(exit, "completed", undefined)).toEqual(exit);
    expect(outcomeOfRun(undefined, "failed", undefined)).toEqual({ kind: "failed", reason: "run_error" });
    expect(outcomeOfRun(undefined, "cancelled", undefined)).toEqual({ kind: "needs_user" });
  });

  it("settles a run once, writes one outcome event, and fails its errand when the run failed", async () => {
    const { budgets, clock, deps } = world();
    const errands = new MemoryErrands();
    const traceSink = new MemoryTrace();
    errands.errands.set("s1", openErrand("s1", 0));
    await recordToolFailure(deps, { run: RUN, failure: { toolName: "search_providers", errorName: "TypeError" } });
    await startModelTurn(deps, RUN);

    const settle = { budgets, errands, traceSink, clock };
    const request = { run: RUN, place: { traceId: "s1", sessionId: "s1" }, ending: "completed", describe: () => "stopped" } as const;
    const outcome = await settleRun(settle, request);
    expect(outcome).toEqual({ kind: "failed", reason: "tool_error", toolName: "search_providers" });
    expect(await settleRun(settle, { ...request, ending: "cancelled" })).toEqual(outcome);

    expect((await errands.find("s1"))?.state).toBe("failed");
    const events = traceSink.records.filter((record) => record.type === "event");
    expect(events.map((event) => event.name)).toEqual(["gathering → failed", "run failed"]);
    expect(events[1]?.attributes).toMatchObject({
      "errand.turn.id": "t1",
      "errand.outcome.kind": "failed",
      "errand.outcome.message": "stopped",
      "errand.failure.reason": "tool_error",
    });
  });
});
