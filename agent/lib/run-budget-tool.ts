import type { ToolContext } from "eve/tools";

import { container } from "../../src/composition/container";
import { getRunDeadline } from "../../src/core/use-cases/get-run-deadline";
import { recordToolFailure } from "../../src/core/use-cases/record-tool-failure";
import { toolRunKeyOf } from "./run-key";

// The tool side of the run budget. The model gate already caps how many tool calls a run makes;
// this covers what only the tool call itself can see:
//
// - a call still running at the run's deadline stops waiting, so a slow tool can't hold the run
//   past its wall-clock limit (the next model call then ends the run `budget_exhausted`);
// - a call that throws is recorded, so the next model call ends the run `failed` with an
//   explanation instead of letting the model carry on as if nothing happened.
//
// Every tool in agent/tools/ is wrapped (run-budget-tool.test.ts checks), so a new tool gets it by
// exporting `withRunBudget(defineTool({...}))`.

export class RunDeadlineError extends Error {
  constructor(toolName: string) {
    super(`${toolName} was still running when the run reached its time limit, so the run stopped waiting for it.`);
    this.name = "RunDeadlineError";
  }
}

const BUDGETED = Symbol.for("errand.run-budget-tool");

interface ExecutableTool {
  execute(input: never, ctx: ToolContext): unknown;
}

function errorName(error: unknown): string {
  if (error instanceof Error) return error.name;
  return typeof error;
}

function untilDeadline<T>(work: Promise<T>, deadlineMs: number, toolName: string): Promise<T> {
  const remaining = deadlineMs - container().wallClock.now().getTime();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new RunDeadlineError(toolName)), Math.max(0, remaining));
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** Wraps the tool's `execute` in the run budget, in place, and returns the same definition. */
export function withRunBudget<T extends ExecutableTool>(definition: T): T {
  const execute = definition.execute.bind(definition) as (input: unknown, ctx: ToolContext) => unknown;
  const budgeted = async (input: unknown, ctx: ToolContext): Promise<unknown> => {
    const run = toolRunKeyOf(ctx);
    const deps = container().runBudgetDependencies;
    const deadlineMs = await getRunDeadline(deps, run);
    try {
      return await untilDeadline(Promise.resolve(execute(input, ctx)), deadlineMs, ctx.toolName);
    } catch (error) {
      if (!(error instanceof RunDeadlineError)) {
        await recordToolFailure(deps, { run, failure: { toolName: ctx.toolName, errorName: errorName(error) } });
      }
      throw error;
    }
  };
  Object.assign(definition, { execute: budgeted, [BUDGETED]: true });
  return definition;
}

export function isBudgetedTool(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[BUDGETED] === true;
}
