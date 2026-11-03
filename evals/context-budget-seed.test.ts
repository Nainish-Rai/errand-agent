import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CONTEXT_BUDGET_MEMORY, CONVERSATION, CONVERSATION_SCRIPT } from "./context-budget-seed";

// The eval and the browser suite seed the same world, so what the browser proves is what the eval
// grades. The suite is JSON (it can't import), so this keeps the copies equal.

interface SuiteStep {
  readonly command: string;
  readonly args?: readonly string[];
  readonly options?: { readonly body?: unknown; readonly value?: string };
}

const suite = JSON.parse(readFileSync(path.join(process.cwd(), "verification/suites/context-budget.json"), "utf8")) as {
  readonly scenarios: readonly { readonly setup: readonly SuiteStep[]; readonly steps: readonly SuiteStep[] }[];
};
const [scenario] = suite.scenarios;

function bodyOf(route: string): unknown {
  return scenario?.setup.find((step) => step.command === "api" && step.args?.[1] === route)?.options?.body;
}

describe("the context-budget world", () => {
  it("has 50+ remembered facts, only three of them current", () => {
    expect(CONTEXT_BUDGET_MEMORY.length).toBeGreaterThanOrEqual(50);
    expect(CONTEXT_BUDGET_MEMORY.filter((fact) => fact.status === "active").map((fact) => fact.key)).toEqual(["area", "budget", "earliest_hour"]);
  });

  it("is seeded the same in the browser suite as in the eval", () => {
    expect(bodyOf("/api/v1/dev/memory")).toEqual({ facts: CONTEXT_BUDGET_MEMORY });
    expect(bodyOf("/api/v1/dev/model-script")).toEqual({ script: { turns: CONVERSATION_SCRIPT } });
    const said = scenario?.steps.filter((step) => step.command === "fill").map((step) => step.options?.value);
    expect(said).toEqual(CONVERSATION.map((message) => message.say));
  });
});
