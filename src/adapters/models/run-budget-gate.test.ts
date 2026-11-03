import type { LanguageModel } from "ai";
import { describe, expect, it } from "vitest";

import type { RunExit } from "../../core/budget/run-budget";
import type { ToolCallsOutcome } from "../../core/use-cases/admit-tool-calls";
import type { ModelFailureOutcome } from "../../core/use-cases/record-model-failure";
import type { ModelTurnOutcome } from "../../core/use-cases/start-model-turn";
import { gatedModel, RUN_BUDGET_RESPONDER, type RunBudgetGate } from "./run-budget-gate";

// The gate on a fake provider model: what reaches eve is what the stream says, so the tests read
// the stream parts and never the gate's internals.

type Part = Record<string, unknown> & { readonly type: string };

const TOOL_CALL: Part = { type: "tool-call", toolCallId: "c1", toolName: "get_errand", input: "{}" };
const FINISH: Part = {
  type: "finish",
  finishReason: { unified: "tool-calls", raw: "tool_use" },
  usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
};
const EXHAUSTED: RunExit = { kind: "budget_exhausted", limit: "tool_calls", used: 3, cap: 3 };

interface FakeModel {
  calls: number;
  readonly model: LanguageModel;
}

function fakeModel(respond: () => Part[]): FakeModel {
  const fake: FakeModel = {
    calls: 0,
    model: {
      specificationVersion: "v4",
      provider: "test",
      modelId: "fake",
      supportedUrls: {},
      doGenerate: () => Promise.reject(new Error("stream only")),
      doStream: async () => {
        fake.calls += 1;
        const parts = respond();
        return {
          stream: new ReadableStream({
            start(controller) {
              for (const part of parts) controller.enqueue(part);
              controller.close();
            },
          }),
        };
      },
    } as unknown as LanguageModel,
  };
  return fake;
}

class FakeGate implements RunBudgetGate {
  turn: ModelTurnOutcome = { kind: "allowed", turn: 1 };
  tools: ToolCallsOutcome = { kind: "admitted" };
  failures: ModelFailureOutcome[] = [];
  admittedCounts: number[] = [];

  async startModelTurn(): Promise<ModelTurnOutcome> {
    return this.turn;
  }

  async admitToolCalls(count: number): Promise<ToolCallsOutcome> {
    this.admittedCounts.push(count);
    return this.tools;
  }

  async recordModelFailure(): Promise<ModelFailureOutcome> {
    return this.failures.shift() ?? { kind: "retry" };
  }

  describe(exit: RunExit): string {
    return `stopped: ${exit.kind}`;
  }
}

async function streamed(model: LanguageModel): Promise<Part[]> {
  const v4 = model as unknown as { doStream(options: unknown): Promise<{ stream: ReadableStream<Part> }> };
  const { stream } = await v4.doStream({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] });
  const parts: Part[] = [];
  const reader = stream.getReader();
  for (let read = await reader.read(); !read.done; read = await reader.read()) parts.push(read.value);
  return parts;
}

function textOf(parts: readonly Part[]): string {
  return parts.flatMap((part) => (part.type === "text-delta" ? [String(part.delta)] : [])).join("");
}

describe("run budget gate", () => {
  it("passes an admitted step through, its tool calls included", async () => {
    const gate = new FakeGate();
    const fake = fakeModel(() => [{ type: "text-start", id: "a" }, { type: "text-delta", id: "a", delta: "ok" }, TOOL_CALL, FINISH]);
    const parts = await streamed(gatedModel(fake.model, gate));
    expect(parts.map((part) => part.type)).toEqual(["text-start", "text-delta", "tool-call", "finish"]);
    expect(gate.admittedCounts).toEqual([1]);
  });

  it("never sends a stopped run to the model and answers with the exit's message", async () => {
    const gate = new FakeGate();
    gate.turn = { kind: "stopped", exit: EXHAUSTED };
    const fake = fakeModel(() => [FINISH]);
    const parts = await streamed(gatedModel(fake.model, gate));
    expect(fake.calls).toBe(0);
    expect(textOf(parts)).toBe("stopped: budget_exhausted");
    expect(parts.some((part) => part.type === "tool-call")).toBe(false);
    expect(parts.find((part) => part.type === "response-metadata")).toMatchObject({ modelId: RUN_BUDGET_RESPONDER });
    expect(parts.at(-1)).toMatchObject({ type: "finish", finishReason: { unified: "stop" } });
  });

  it("drops the tool calls of a step over the budget and ends it with the exit's message", async () => {
    const gate = new FakeGate();
    gate.tools = { kind: "stopped", exit: EXHAUSTED };
    const fake = fakeModel(() => [{ type: "tool-input-start", id: "c1", toolName: "get_errand" }, { type: "tool-input-end", id: "c1" }, TOOL_CALL, FINISH]);
    const parts = await streamed(gatedModel(fake.model, gate));
    expect(parts.some((part) => part.type.startsWith("tool-"))).toBe(false);
    expect(textOf(parts)).toBe("stopped: budget_exhausted");
    expect(parts.at(-1)).toMatchObject({ type: "finish", finishReason: { unified: "stop" } });
  });

  it("lets a failing model call be retried, and answers with the exit once retries are spent", async () => {
    const gate = new FakeGate();
    const failing: LanguageModel = {
      ...(fakeModel(() => []).model as object),
      doStream: () => Promise.reject(new Error("overloaded")),
    } as unknown as LanguageModel;
    await expect(streamed(gatedModel(failing, gate))).rejects.toThrow("overloaded");
    gate.failures = [{ kind: "stopped", exit: { kind: "failed", reason: "model_error" } }];
    expect(textOf(await streamed(gatedModel(failing, gate)))).toBe("stopped: failed");
  });
});
