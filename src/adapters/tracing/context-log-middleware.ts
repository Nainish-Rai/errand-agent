import { createHash } from "node:crypto";

import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from "ai";

import type { RunKey } from "../../core/budget/run-budget";
import {
  packModelContext,
  type ContextBudget,
  type ContextParts,
  type HistoryMessage,
  type HistoryRole,
  type InstructionBlock,
  type MemoryMessage,
  type PackedContext,
} from "../../core/context/context-budget";
import { estimateMessageTokens, estimateTokens } from "../../core/context/token-estimate";
import type { TracePlace } from "../../core/errand/errand-workflow";
import { MEMORY_CONTEXT_HEADING } from "../../core/use-cases/build-model-context";
import type { RecordModelContextRequest } from "../../core/use-cases/record-model-context";

// The context wrapper: AI SDK middleware around the main model, in the same chain as the run
// budget gate (the gate is outside it, so a call the budget stops is never packed or logged).
// Before every model call it sorts the prompt eve built into instructions (every system message
// and tool definition), memory (the remembered-facts message) and history, lets core pack it into
// the fixed context budget, rebuilds the prompt from what core kept, and logs exactly that to the
// run trace. A context core refuses is logged and never sent.

type CallOptions = Parameters<NonNullable<LanguageModelMiddleware["transformParams"]>>[0]["params"];
type Prompt = CallOptions["prompt"];
type PromptMessage = Prompt[number];
type Tools = NonNullable<CallOptions["tools"]>;

export class ContextOverBudgetError extends Error {
  constructor(part: string) {
    super(`The model's context is over budget (${part}), so the call was not sent. See the run trace's model context event.`);
    this.name = "ContextOverBudgetError";
  }
}

/**
 * Where each run's current model call sits in the trace. The run trace notes the chat span when a
 * call starts (eve publishes that before it calls the model), and the wrapper reads it, so the
 * context event hangs off the call it describes.
 */
export class ModelCallPlaces {
  readonly #places = new Map<string, TracePlace>();

  static #key(run: RunKey): string {
    return `${run.sessionId}\u0000${run.turnId}`;
  }

  callStarted(run: RunKey, place: TracePlace): void {
    this.#places.set(ModelCallPlaces.#key(run), place);
  }

  callSettled(run: RunKey): void {
    this.#places.delete(ModelCallPlaces.#key(run));
  }

  placeOf(run: RunKey): TracePlace {
    return this.#places.get(ModelCallPlaces.#key(run)) ?? { traceId: run.sessionId, sessionId: run.sessionId };
  }
}

export interface ContextLog {
  readonly budget: ContextBudget;
  readonly run: RunKey;
  readonly places: ModelCallPlaces;
  record(request: RecordModelContextRequest): Promise<void>;
}

/** A message's content as text: text parts as they are, anything else (tool calls and results, files) as JSON. */
function textOf(message: PromptMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content.map((part) => (part.type === "text" || part.type === "reasoning" ? part.text : JSON.stringify(part))).join("\n");
}

function isMemoryMessage(message: PromptMessage): boolean {
  return message.role === "user" && textOf(message).trimStart().startsWith(MEMORY_CONTEXT_HEADING);
}

function firstLine(text: string): string {
  return (text.split("\n", 1)[0] ?? "").slice(0, 80);
}

export function partsOf(prompt: Prompt, tools: Tools | undefined): ContextParts {
  const instructions: InstructionBlock[] = [];
  const memory: MemoryMessage[] = [];
  const history: HistoryMessage[] = [];
  prompt.forEach((message, index) => {
    const text = textOf(message);
    const tokens = estimateMessageTokens(text);
    if (message.role === "system") instructions.push({ kind: "system", label: firstLine(text), tokens });
    else if (isMemoryMessage(message)) memory.push({ index, text, tokens });
    else history.push({ index, role: message.role as HistoryRole, fromPerson: message.role === "user", text, tokens });
  });
  for (const tool of tools ?? []) instructions.push({ kind: "tool", label: tool.name, tokens: estimateTokens(JSON.stringify(tool)) });
  return { instructions, memory, history };
}

/** The prompt core packed: system and memory messages as they were, kept history, and the summary in its place. */
export function packedPrompt(prompt: Prompt, packing: PackedContext): Prompt {
  const kept = new Set(packing.kept.map((message) => message.index));
  const dropped = new Set(packing.dropped.map((message) => message.index));
  const rebuilt: Prompt = [];
  prompt.forEach((message, index) => {
    if (packing.summary?.insertBefore === index) rebuilt.push({ role: "user", content: [{ type: "text", text: packing.summary.text }] });
    if (dropped.has(index)) return;
    if (message.role === "system" || isMemoryMessage(message) || kept.has(index)) rebuilt.push(message);
  });
  return rebuilt;
}

function sha256Of(prompt: Prompt, tools: Tools | undefined): string {
  return createHash("sha256").update(JSON.stringify({ prompt, tools: tools ?? [] })).digest("hex");
}

function contextMiddleware(log: ContextLog): LanguageModelMiddleware {
  return {
    specificationVersion: "v4",
    async transformParams({ params }) {
      const parts = partsOf(params.prompt, params.tools);
      const packing = packModelContext(log.budget, parts);
      const place = log.places.placeOf(log.run);
      const common = { place, turnId: log.run.turnId, budget: log.budget, parts, packing };
      if (packing.kind === "over_budget") {
        await log.record(common);
        throw new ContextOverBudgetError(packing.part);
      }
      const prompt = packedPrompt(params.prompt, packing);
      await log.record({ ...common, promptSha256: sha256Of(prompt, params.tools) });
      return { ...params, prompt };
    },
  };
}

/** The model held to the context budget, every call's context logged. */
export function contextBudgetedModel(model: LanguageModel, log: ContextLog): LanguageModel {
  if (typeof model === "string") throw new Error(`The context budget wraps a model instance, not the gateway id "${model}".`);
  return wrapLanguageModel({ model, middleware: contextMiddleware(log) });
}
