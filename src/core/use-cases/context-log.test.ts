import { describe, expect, it } from "vitest";

import { packModelContext, type ContextBudget, type ContextParts } from "../context/context-budget";
import type { TraceRecord, TraceSink } from "../ports/trace-sink";
import { getSessionContext } from "./get-session-context";
import { recordModelContext } from "./record-model-context";

// The context log through the trace sink: what the wrapper records for a call is what the context
// route serves, joined with the memory selection whose text the call sent.

class Sink implements TraceSink {
  readonly records: TraceRecord[] = [];

  async record(record: TraceRecord): Promise<void> {
    this.records.push(record);
  }

  async read(): Promise<readonly TraceRecord[]> {
    return this.records;
  }
}

const BUDGET: ContextBudget = { capTokens: 1_000, split: { instructions: 300, memory: 100, history: 600 } };
const MEMORY_TEXT = "Remembered about this person.\n- Area: HSR Layout (the person said it)";

function clockAt(ms: number) {
  return { now: () => new Date(ms) };
}

function parts(withMemory: boolean): ContextParts {
  return {
    instructions: [{ kind: "system", label: "Instructions", tokens: 120 }],
    memory: withMemory ? [{ index: 1, text: MEMORY_TEXT, tokens: 40 }] : [],
    history: [{ index: 2, role: "user", fromPerson: true, text: "find a plumber this week", tokens: 16 }],
  };
}

function memoryEvent(timeMs: number, sessionId = "s1"): TraceRecord {
  return {
    type: "event",
    traceId: "s1",
    eventId: `${sessionId}:memory-context:turn_1`,
    sessionId,
    kind: "context",
    name: "memory context",
    timeMs,
    attributes: {
      "errand.memory.included": [{ id: "f2", key: "area", value: "HSR Layout", source: "explicit", status: "active", reason: "fills_missing_detail" }],
      "errand.memory.excluded": [{ id: "f1", key: "area", value: "Koramangala", source: "explicit", status: "forgotten", reason: "forgotten" }],
      "errand.memory.now_ms": 42,
    },
  };
}

async function logCall(sink: Sink, atMs: number, input: ContextParts): Promise<void> {
  await recordModelContext(
    { traceSink: sink, clock: clockAt(atMs) },
    { place: { traceId: "s1", sessionId: "s1", spanId: `model:${atMs}` }, turnId: "turn_1", budget: BUDGET, parts: input, packing: packModelContext(BUDGET, input), promptSha256: "ab" },
  );
}

describe("the context log", () => {
  it("serves each call with its tokens against the cap and the facts its memory text carried", async () => {
    const sink = new Sink();
    sink.records.push(memoryEvent(1_000));
    await logCall(sink, 1_500, parts(true));
    const { calls } = await getSessionContext(sink, "s1");
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call).toMatchObject({
      spanId: "model:1500",
      turnId: "turn_1",
      outcome: "sent",
      capTokens: 1_000,
      split: BUDGET.split,
      tokens: { instructions: 120, tools: 0, memory: 40, history: 16, summary: 0, total: 176 },
      estimator: "utf8_bytes/2",
      promptSha256: "ab",
    });
    expect(call?.memory.text).toBe(MEMORY_TEXT);
    expect(call?.memory.included.map((fact) => [fact.value, fact.reason])).toEqual([["HSR Layout", "fills_missing_detail"]]);
    expect(call?.memory.excluded.map((fact) => [fact.value, fact.reason])).toEqual([["Koramangala", "forgotten"]]);
    expect(call?.memory.nowMs).toBe(42);
    expect(call?.history.kept.map((message) => message.preview)).toEqual(["find a plumber this week"]);
  });

  it("claims no facts for a call that carried no memory text", async () => {
    const sink = new Sink();
    sink.records.push(memoryEvent(1_000));
    await logCall(sink, 1_500, parts(false));
    const [call] = (await getSessionContext(sink, "s1")).calls;
    expect(call?.memory).toEqual({ text: "", included: [], excluded: [], nowMs: null });
  });

  it("logs a refused context with everything it would have dropped", async () => {
    const sink = new Sink();
    const tooBig: ContextParts = { ...parts(false), instructions: [{ kind: "system", label: "Instructions", tokens: 900 }] };
    await logCall(sink, 2_000, tooBig);
    const [call] = (await getSessionContext(sink, "s1")).calls;
    expect(call).toMatchObject({ outcome: "refused", overBudgetPart: "instructions", promptSha256: null });
    expect(call?.history.dropped).toHaveLength(1);
  });
});
