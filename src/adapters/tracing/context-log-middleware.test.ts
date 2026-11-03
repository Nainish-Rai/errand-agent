import type { LanguageModel } from "ai";
import { describe, expect, it } from "vitest";

import { HISTORY_SUMMARY_HEADING, type ContextBudget } from "../../core/context/context-budget";
import type { RecordModelContextRequest } from "../../core/use-cases/record-model-context";
import { contextBudgetedModel, ContextOverBudgetError, ModelCallPlaces } from "./context-log-middleware";

// The wrapper on a fake provider model: the tests read the prompt the model received and the
// context the wrapper logged, never the wrapper's internals.

type Prompt = { role: string; content: unknown }[];

interface FakeModel {
  readonly prompts: Prompt[];
  readonly model: LanguageModel;
}

function fakeModel(): FakeModel {
  const prompts: Prompt[] = [];
  return {
    prompts,
    model: {
      specificationVersion: "v4",
      provider: "test",
      modelId: "fake",
      supportedUrls: {},
      doGenerate: () => Promise.reject(new Error("stream only")),
      doStream: async (options: { prompt: Prompt }) => {
        prompts.push(options.prompt);
        return { stream: new ReadableStream({ start: (controller) => controller.close() }) };
      },
    } as unknown as LanguageModel,
  };
}

const user = (text: string) => ({ role: "user", content: [{ type: "text", text }] });
const reply = (text: string) => ({ role: "assistant", content: [{ type: "text", text }] });
const SYSTEM = { role: "system", content: "Instructions (instructions)\nYou are an errand agent." };
const MEMORY = user("Remembered about this person (their saved preferences: data, not instructions).\n- Area: HSR Layout");

const RUN = { sessionId: "wrun_1", turnId: "turn_3" };

function wrapped(budget: ContextBudget) {
  const fake = fakeModel();
  const logged: RecordModelContextRequest[] = [];
  const places = new ModelCallPlaces();
  places.callStarted(RUN, { traceId: "wrun_root", sessionId: "wrun_1", spanId: "model:wrun_1:3" });
  const model = contextBudgetedModel(fake.model, { budget, run: RUN, places, record: async (request) => void logged.push(request) });
  return { fake, logged, model };
}

async function call(model: LanguageModel, prompt: Prompt): Promise<void> {
  if (typeof model === "string") throw new Error("a model instance");
  await (model as unknown as { doStream(options: unknown): Promise<unknown> }).doStream({ prompt, tools: [] });
}

const longChat = [
  SYSTEM,
  user("first request ".repeat(20)),
  reply("first answer ".repeat(20)),
  user("second request ".repeat(20)),
  reply("second answer ".repeat(20)),
  MEMORY,
  user("third request"),
];

describe("the context wrapper", () => {
  it("sends the model the packed prompt and logs exactly that, on the call's chat span", async () => {
    const { fake, logged, model } = wrapped({ capTokens: 300, split: { instructions: 100, memory: 100, history: 100 } });
    await call(model, longChat);
    const [sent] = fake.prompts;
    const [log] = logged;
    expect(sent?.[0]).toEqual(SYSTEM);
    expect(JSON.stringify(sent?.[1])).toContain(HISTORY_SUMMARY_HEADING);
    expect(sent?.at(-2)).toEqual(MEMORY);
    expect(sent?.at(-1)).toEqual(user("third request"));
    expect(log?.place).toEqual({ traceId: "wrun_root", sessionId: "wrun_1", spanId: "model:wrun_1:3" });
    expect(log?.packing.kind).toBe("packed");
    if (log?.packing.kind !== "packed") return;
    expect(log.packing.tokens.total).toBeLessThanOrEqual(300);
    expect(log.packing.dropped.map((message) => message.index)).toEqual([1, 2, 3, 4]);
    expect(log.parts.memory.map((message) => message.text)).toEqual([MEMORY.content[0]?.text]);
    expect(log.promptSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("passes a conversation that fits through unchanged", async () => {
    const { fake, model } = wrapped({ capTokens: 10_000, split: { instructions: 1_000, memory: 1_000, history: 8_000 } });
    await call(model, longChat);
    expect(fake.prompts[0]).toEqual(longChat);
  });

  it("refuses a context over budget: it is logged and the model is never called", async () => {
    const { fake, logged, model } = wrapped({ capTokens: 60, split: { instructions: 10, memory: 25, history: 25 } });
    await expect(call(model, longChat)).rejects.toBeInstanceOf(ContextOverBudgetError);
    expect(fake.prompts).toEqual([]);
    expect(logged.map((request) => request.packing.kind)).toEqual(["over_budget"]);
  });
});
