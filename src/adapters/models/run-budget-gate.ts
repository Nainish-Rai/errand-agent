import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from "ai";

import type { RunExit } from "../../core/budget/run-budget";
import type { ToolCallsOutcome } from "../../core/use-cases/admit-tool-calls";
import type { ModelTurnOutcome } from "../../core/use-cases/start-model-turn";
import type { ModelFailureOutcome } from "../../core/use-cases/record-model-failure";

// Holds a run to its budget at the one place every step passes: the model call. eve has no caps
// of its own on model calls, tool calls or time per turn, so the main model is wrapped (AI SDK
// middleware) for each run:
//
// - before a call, the run is charged a model turn; a run that is out of budget, past its
//   deadline, or that a tool failed in is not sent to the model at all;
// - the tool calls a response asks for are held back until the response finishes, then admitted
//   all together or not at all, so a call over the cap never reaches a tool;
// - a model call that keeps failing ends the run once its retries are spent.
//
// A stopped run answers with its outcome's message as an ordinary final reply (no tool calls), so
// the turn ends cleanly and the person sees why. The gate works on whatever tools the model calls,
// so every tool any ticket adds is covered without touching it.

type WrapStream = NonNullable<LanguageModelMiddleware["wrapStream"]>;
type WrapGenerate = NonNullable<LanguageModelMiddleware["wrapGenerate"]>;
type StreamResult = Awaited<ReturnType<WrapStream>>;
type GenerateResult = Awaited<ReturnType<WrapGenerate>>;
type StreamPart = StreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;
type ContentPart = GenerateResult["content"][number];

/** The run's budget, as the gate sees it: bound to one run by the composition root. */
export interface RunBudgetGate {
  startModelTurn(): Promise<ModelTurnOutcome>;
  admitToolCalls(count: number): Promise<ToolCallsOutcome>;
  recordModelFailure(): Promise<ModelFailureOutcome>;
  /** The exit's one user-facing message, from the agent's presenter. */
  describe(exit: RunExit): string;
}

/** Shown as the response model of a reply the gate wrote, so the trace says who answered. */
export const RUN_BUDGET_RESPONDER = "errand-run-budget";

const STOPPED = { unified: "stop", raw: "run_budget" } as const;
const NO_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};
const EXIT_TEXT_ID = "run-budget-exit";

function isToolPart(part: StreamPart): boolean {
  if (part.type === "tool-call") return part.providerExecuted !== true;
  return part.type === "tool-input-start" || part.type === "tool-input-delta" || part.type === "tool-input-end";
}

function exitParts(message: string): StreamPart[] {
  return [
    { type: "text-start", id: EXIT_TEXT_ID },
    { type: "text-delta", id: EXIT_TEXT_ID, delta: message },
    { type: "text-end", id: EXIT_TEXT_ID },
  ];
}

function exitStream(message: string): StreamResult {
  const parts: StreamPart[] = [
    { type: "stream-start", warnings: [] },
    { type: "response-metadata", modelId: RUN_BUDGET_RESPONDER },
    ...exitParts(message),
    { type: "finish", usage: NO_USAGE, finishReason: STOPPED },
  ];
  return {
    stream: new ReadableStream<StreamPart>({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    }),
  };
}

/** Passes text through as it streams and holds tool calls until the budget has admitted them. */
function admittingToolCalls(gate: RunBudgetGate): TransformStream<StreamPart, StreamPart> {
  const held: StreamPart[] = [];
  return new TransformStream<StreamPart, StreamPart>({
    async transform(part, controller) {
      if (isToolPart(part)) {
        held.push(part);
        return;
      }
      if (part.type !== "finish") {
        controller.enqueue(part);
        return;
      }
      const admitted = await gate.admitToolCalls(held.filter((entry) => entry.type === "tool-call").length);
      if (admitted.kind === "admitted") {
        for (const entry of held.splice(0)) controller.enqueue(entry);
        controller.enqueue(part);
        return;
      }
      held.length = 0;
      for (const entry of exitParts(gate.describe(admitted.exit))) controller.enqueue(entry);
      controller.enqueue({ ...part, finishReason: STOPPED });
    },
    flush(controller) {
      // A stream that ended without a finish part is broken anyway; let eve see what it sent.
      for (const entry of held.splice(0)) controller.enqueue(entry);
    },
  });
}

function exitContent(message: string): GenerateResult {
  return { content: [{ type: "text", text: message }], finishReason: STOPPED, usage: NO_USAGE, warnings: [] };
}

function isToolCall(part: ContentPart): boolean {
  return part.type === "tool-call" && part.providerExecuted !== true;
}

async function failedCall(gate: RunBudgetGate, error: unknown): Promise<RunExit> {
  const failure = await gate.recordModelFailure();
  if (failure.kind === "retry") throw error;
  return failure.exit;
}

function budgetMiddleware(gate: RunBudgetGate): LanguageModelMiddleware {
  return {
    specificationVersion: "v4",
    async wrapStream({ doStream }) {
      const turn = await gate.startModelTurn();
      if (turn.kind === "stopped") return exitStream(gate.describe(turn.exit));
      let result: StreamResult;
      try {
        result = await doStream();
      } catch (error) {
        return exitStream(gate.describe(await failedCall(gate, error)));
      }
      return { ...result, stream: result.stream.pipeThrough(admittingToolCalls(gate)) };
    },
    async wrapGenerate({ doGenerate }) {
      const turn = await gate.startModelTurn();
      if (turn.kind === "stopped") return exitContent(gate.describe(turn.exit));
      let result: GenerateResult;
      try {
        result = await doGenerate();
      } catch (error) {
        return exitContent(gate.describe(await failedCall(gate, error)));
      }
      const admitted = await gate.admitToolCalls(result.content.filter(isToolCall).length);
      if (admitted.kind === "admitted") return result;
      return {
        ...result,
        content: [...result.content.filter((part) => !isToolCall(part)), { type: "text", text: gate.describe(admitted.exit) }],
        finishReason: STOPPED,
      };
    },
  };
}

export function gatedModel(model: LanguageModel, gate: RunBudgetGate): LanguageModel {
  if (typeof model === "string") throw new Error(`The run budget wraps a model instance, not the gateway id "${model}".`);
  return wrapLanguageModel({ model, middleware: budgetMiddleware(gate) });
}
