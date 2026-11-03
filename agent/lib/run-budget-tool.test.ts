import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ToolContext } from "eve/tools";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { container } from "../../src/composition/container";
import { startModelTurn } from "../../src/core/use-cases/start-model-turn";
import { isBudgetedTool, RunDeadlineError, withRunBudget } from "./run-budget-tool";

// The tool half of the run budget. Its first test is the guard that keeps it generic: a tool a
// later ticket adds without `withRunBudget` fails `pnpm check` here.

const TOOLS_DIR = path.join(import.meta.dirname, "..", "tools");

function contextFor(turnId: string, toolName: string): ToolContext {
  return { session: { id: "wrun_tool_test", turn: { id: turnId } }, toolName, callId: `${turnId}-call` } as unknown as ToolContext;
}

beforeAll(() => {
  // The container opens its database on first use; keep it out of the checkout.
  process.env.ERRAND_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "errand-tool-budget-"));
});

afterEach(() => {
  container().setRunLimits(null);
});

describe("tools under the run budget", () => {
  it("every tool the model can call is held to the run budget", async () => {
    const files = fs.readdirSync(TOOLS_DIR).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const tool = ((await import(path.join(TOOLS_DIR, file))) as { default: unknown }).default;
      expect({ file, budgeted: isBudgetedTool(tool) }).toEqual({ file, budgeted: true });
    }
  });

  it("a tool still running at the run's deadline stops waiting, without counting as a tool failure", async () => {
    container().setRunLimits({ wallClockMs: 50 });
    const slow = withRunBudget({
      execute: (_input: unknown, _ctx: ToolContext) => new Promise((resolve) => setTimeout(() => resolve("late"), 2_000)),
    });
    const started = Date.now();
    await expect(slow.execute(undefined as never, contextFor("turn_slow", "slow_tool"))).rejects.toBeInstanceOf(RunDeadlineError);
    expect(Date.now() - started).toBeLessThan(1_000);
    const budget = await container().runBudgets.find({ sessionId: "wrun_tool_test", turnId: "turn_slow" });
    expect(budget?.toolFailure).toBeUndefined();
  });

  it("a tool that throws ends the run failed at the next model call", async () => {
    const broken = withRunBudget({
      execute: (_input: unknown, _ctx: ToolContext): never => {
        throw new TypeError("Cannot read properties of undefined");
      },
    });
    await expect(broken.execute(undefined as never, contextFor("turn_broken", "broken_tool"))).rejects.toBeInstanceOf(TypeError);
    expect(await startModelTurn(container().runBudgetDependencies, { sessionId: "wrun_tool_test", turnId: "turn_broken" })).toEqual({
      kind: "stopped",
      exit: { kind: "failed", reason: "tool_error", toolName: "broken_tool" },
    });
  });
});
