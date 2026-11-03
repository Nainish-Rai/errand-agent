import { describe, expect, it } from "vitest";

import {
  CONTEXT_BUDGET,
  HISTORY_SUMMARY_HEADING,
  packModelContext,
  personsMessagesLeftOutIn,
  type ContextBudget,
  type ContextParts,
  type HistoryMessage,
  type PackedContext,
} from "./context-budget";
import { estimateMessageTokens, estimateTokens } from "./token-estimate";

const BUDGET: ContextBudget = { capTokens: 1_000, split: { instructions: 300, memory: 100, history: 600 } };

const INSTRUCTIONS = [
  { kind: "system", label: "Instructions", tokens: 200 },
  { kind: "tool", label: "search_providers", tokens: 50 },
] as const;

/** A conversation of `turns` exchanges: the person asks, the model calls a tool, the tool answers, the model replies. */
function conversation(turns: number, toolResultTokens = 40, startIndex = 1): HistoryMessage[] {
  const messages: HistoryMessage[] = [];
  let index = startIndex;
  for (let turn = 0; turn < turns; turn += 1) {
    messages.push({ index: index++, role: "user", fromPerson: true, text: `request ${turn + 1}`, tokens: 10 });
    messages.push({ index: index++, role: "assistant", fromPerson: false, text: `{"toolName":"search_providers"}`, tokens: 12 });
    messages.push({ index: index++, role: "tool", fromPerson: false, text: `{"providers":[]}`, tokens: toolResultTokens });
    messages.push({ index: index++, role: "assistant", fromPerson: false, text: `answer ${turn + 1}`, tokens: 8 });
  }
  return messages;
}

function parts(history: HistoryMessage[], memoryTokens = 60): ContextParts {
  return { instructions: [...INSTRUCTIONS], memory: memoryTokens === 0 ? [] : [{ index: 0, text: "Remembered", tokens: memoryTokens }], history };
}

function packed(budget: ContextBudget, input: ContextParts): PackedContext {
  const packing = packModelContext(budget, input);
  if (packing.kind !== "packed") throw new Error(`expected a packed context, got ${packing.part} over budget`);
  return packing;
}

/** A small deterministic generator, so the property test is the same on every run. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

describe("the context budget", () => {
  it("declares a split that adds up to the cap", () => {
    const { capTokens, split } = CONTEXT_BUDGET;
    expect(split.instructions + split.memory + split.history).toBe(capTokens);
  });

  it("sends a short conversation whole", () => {
    const history = conversation(2);
    const packing = packed(BUDGET, parts(history));
    expect(packing.dropped).toEqual([]);
    expect(packing.summary).toBeUndefined();
    expect(packing.tokens).toEqual({ instructions: 200, tools: 50, memory: 60, history: 140, summary: 0, total: 450 });
  });

  it("never exceeds the cap, whatever the conversation", () => {
    const random = seeded(12);
    for (let trial = 0; trial < 300; trial += 1) {
      const history = conversation(1 + Math.floor(random() * 30), Math.floor(random() * 120));
      const packing = packModelContext(BUDGET, parts(history, Math.floor(random() * 100)));
      if (packing.kind === "over_budget") continue;
      expect(packing.tokens.total).toBeLessThanOrEqual(BUDGET.capTokens);
      expect(packing.tokens.history).toBeLessThanOrEqual(packing.historyLimitTokens);
      // What the log says was sent is what the parts cost.
      const sent = [...packing.kept.map((message) => message.tokens), packing.summary?.tokens ?? 0].reduce((a, b) => a + b, 0);
      expect(packing.tokens.history).toBe(sent);
    }
  });

  it("drops the oldest exchanges whole, keeps the newest and the current one, and summarises what the person said", () => {
    const history = conversation(12);
    const packing = packed(BUDGET, parts(history));
    expect(packing.dropped.length).toBeGreaterThan(0);
    // Every kept message is newer than every dropped one.
    expect(Math.max(...packing.dropped.map((message) => message.index))).toBeLessThan(Math.min(...packing.kept.map((message) => message.index)));
    // Exchanges stay whole: a tool call never loses its result, so the kept part starts with the person speaking.
    expect(packing.kept[0]?.fromPerson).toBe(true);
    expect(packing.dropped.length % 4).toBe(0);
    expect(packing.kept.at(-1)).toEqual(history.at(-1));
    expect(packing.summary?.text.startsWith(HISTORY_SUMMARY_HEADING)).toBe(true);
    expect(packing.summary?.text).toContain('"request 1"');
    expect(personsMessagesLeftOutIn(packing.summary?.text ?? "")).toBe(packing.dropped.filter((message) => message.fromPerson).length);
    expect(packing.summary?.tokens).toBe(estimateMessageTokens(packing.summary?.text ?? ""));
  });

  it("puts the summary before the earliest kept message or the memory, whichever comes first", () => {
    const history = conversation(12);
    const packing = packed(BUDGET, parts(history));
    expect(packing.summary?.insertBefore).toBe(0);
    const withoutMemory = packed(BUDGET, parts(history, 0));
    expect(withoutMemory.summary?.insertBefore).toBe(withoutMemory.kept[0]?.index);
  });

  it("packs the same conversation the same way every time", () => {
    const history = conversation(15, 30);
    expect(packModelContext(BUDGET, parts(history))).toEqual(packModelContext(BUDGET, parts(history)));
  });

  it("refuses instructions over their share instead of trimming them", () => {
    const tooMuch: ContextParts = { ...parts(conversation(1)), instructions: [{ kind: "system", label: "Instructions", tokens: 301 }] };
    expect(packModelContext(BUDGET, tooMuch)).toMatchObject({ kind: "over_budget", part: "instructions" });
  });

  it("refuses memory over its share", () => {
    expect(packModelContext(BUDGET, parts(conversation(1), 101))).toMatchObject({ kind: "over_budget", part: "memory" });
  });

  it("refuses a current exchange that can't fit on its own rather than cutting it", () => {
    expect(packModelContext(BUDGET, parts(conversation(1, 900)))).toMatchObject({ kind: "over_budget", part: "history" });
  });

  it("gives history what instructions and memory leave unused", () => {
    expect(packed(BUDGET, parts(conversation(1), 0)).historyLimitTokens).toBe(750);
    expect(packed(BUDGET, parts(conversation(1), 100)).historyLimitTokens).toBe(650);
  });
});

describe("the token estimate", () => {
  it("counts one token per two UTF-8 bytes, rounded up, so it never undercounts a multi-byte character", () => {
    expect(estimateTokens("abcd")).toBe(2);
    expect(estimateTokens("abc")).toBe(2);
    expect(estimateTokens("₹")).toBe(2);
    expect(estimateMessageTokens("")).toBeGreaterThan(0);
  });
});
