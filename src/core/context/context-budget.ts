// The model's context has a fixed token budget, split three ways and never exceeded:
//
// - instructions: every system message (the agent's instructions, today's date, eve's own blocks,
//   any block a later ticket adds) and every tool definition. They are never trimmed, so they must
//   fit their share; a context whose instructions don't is refused, not sent.
// - memory: the remembered facts, packed into their share by build-model-context (the
//   lowest-ranked facts are left out first).
// - history: the conversation. It always gets at least its share, plus whatever the other two
//   leave unused. When the conversation is longer, the oldest exchanges are dropped whole (an
//   exchange is one message from the person and every reply and tool result after it, so a tool
//   call never loses its result) and replaced by one deterministic summary of what the person said
//   in them. The current exchange is always kept; if even that can't fit, the context is refused.

import { estimateMessageTokens } from "./token-estimate";

export interface ContextSplit {
  readonly instructions: number;
  readonly memory: number;
  readonly history: number;
}

export interface ContextBudget {
  readonly capTokens: number;
  /** The declared split; its parts add up to the cap. */
  readonly split: ContextSplit;
}

/**
 * 40k estimated tokens (about 32k real MiniMax tokens, see token-estimate.ts). Today's instructions
 * and 18 tool definitions take about 12k; the instructions share leaves room for the generated-UI
 * instructions ticket 17 adds.
 */
export const CONTEXT_BUDGET: ContextBudget = {
  capTokens: 40_000,
  split: { instructions: 24_000, memory: 1_000, history: 15_000 },
};

/** One block of what the model is told. Never trimmed. */
export interface InstructionBlock {
  readonly kind: "system" | "tool";
  /** The block's first line, or the tool's name. */
  readonly label: string;
  readonly tokens: number;
}

export type HistoryRole = "user" | "assistant" | "tool";

export interface HistoryMessage {
  /** Where the message sits in the prompt, so the adapter can rebuild it. */
  readonly index: number;
  readonly role: HistoryRole;
  /** A message the person wrote. Each one starts an exchange. */
  readonly fromPerson: boolean;
  readonly text: string;
  readonly tokens: number;
}

export interface MemoryMessage {
  readonly index: number;
  readonly text: string;
  readonly tokens: number;
}

/** The prompt as the context builder sees it, in three parts. */
export interface ContextParts {
  readonly instructions: readonly InstructionBlock[];
  readonly memory: readonly MemoryMessage[];
  readonly history: readonly HistoryMessage[];
}

export interface ContextTokens {
  /** System messages. */
  readonly instructions: number;
  /** Tool definitions, charged to the instructions share. */
  readonly tools: number;
  readonly memory: number;
  /** Kept history, the summary included. */
  readonly history: number;
  readonly summary: number;
  readonly total: number;
}

export interface HistorySummary {
  readonly text: string;
  readonly tokens: number;
  /** The summary goes just before the prompt message at this index. */
  readonly insertBefore: number;
}

export interface PackedContext {
  readonly kind: "packed";
  readonly kept: readonly HistoryMessage[];
  readonly dropped: readonly HistoryMessage[];
  readonly summary?: HistorySummary;
  readonly tokens: ContextTokens;
  /** What history could take this call: the cap minus instructions and memory. */
  readonly historyLimitTokens: number;
}

export type OverBudgetPart = "instructions" | "memory" | "history";

/** Sending this context would break the cap or a part's share, so it isn't sent. */
export interface ContextOverBudget {
  readonly kind: "over_budget";
  readonly part: OverBudgetPart;
  /** What the context would have cost with nothing dropped. */
  readonly tokens: ContextTokens;
  readonly historyLimitTokens: number;
}

export type ContextPacking = PackedContext | ContextOverBudget;

/** The summary's first words, so any reader (the offline model included) can tell it from a person's message. */
export const HISTORY_SUMMARY_HEADING = "Earlier in this conversation";

const SUMMARY_LINES = 6;
const SUMMARY_QUOTE_CHARACTERS = 100;
const SUMMARY_PATTERN = new RegExp(`^${HISTORY_SUMMARY_HEADING}: \\d+ older messages? (?:was|were) left out to fit the context budget, (\\d+) of them from the person`);

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function oneLine(text: string, characters: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= characters ? flat : `${flat.slice(0, characters - 1)}…`;
}

/** How many of the person's messages a summary says were left out; undefined for any other text. */
export function personsMessagesLeftOutIn(text: string): number | undefined {
  const match = SUMMARY_PATTERN.exec(text);
  return match === null ? undefined : Number(match[1]);
}

/** The summary of the dropped messages, quoting at most `lines` of the person's latest dropped words. */
function summaryText(dropped: readonly HistoryMessage[], lines: number): string {
  const said = dropped.filter((message) => message.fromPerson);
  const quoted = said.slice(Math.max(0, said.length - lines));
  const plural = dropped.length === 1 ? "message was" : "messages were";
  return [
    `${HISTORY_SUMMARY_HEADING}: ${dropped.length} older ${plural} left out to fit the context budget, ${said.length} of them from the person.` +
      (quoted.length === 0 ? "" : " What the person said then, oldest first:"),
    ...(quoted.length < said.length ? [`- (${said.length - quoted.length} earlier messages not quoted)`] : []),
    ...quoted.map((message) => `- "${oneLine(message.text, SUMMARY_QUOTE_CHARACTERS)}"`),
  ].join("\n");
}

/** The biggest summary that fits in `room` tokens, or undefined when not even the heading does. */
function fittingSummary(dropped: readonly HistoryMessage[], room: number): { text: string; tokens: number } | undefined {
  for (let lines = SUMMARY_LINES; lines >= 0; lines -= 1) {
    const text = summaryText(dropped, lines);
    const tokens = estimateMessageTokens(text);
    if (tokens <= room) return { text, tokens };
  }
  return undefined;
}

interface Exchanges {
  /** Messages before the person's first message: kept as they are. */
  readonly preamble: readonly HistoryMessage[];
  /** Oldest first; the last one is the exchange the model is answering now. */
  readonly exchanges: readonly (readonly HistoryMessage[])[];
}

function exchangesOf(history: readonly HistoryMessage[]): Exchanges {
  const preamble: HistoryMessage[] = [];
  const exchanges: HistoryMessage[][] = [];
  for (const message of history) {
    if (message.fromPerson) exchanges.push([message]);
    else (exchanges.at(-1) ?? preamble).push(message);
  }
  return { preamble, exchanges };
}

function tokensOf(parts: ContextParts, history: number, summary: number): ContextTokens {
  const instructions = sum(parts.instructions.filter((block) => block.kind === "system").map((block) => block.tokens));
  const tools = sum(parts.instructions.filter((block) => block.kind === "tool").map((block) => block.tokens));
  const memory = sum(parts.memory.map((message) => message.tokens));
  return { instructions, tools, memory, history, summary, total: instructions + tools + memory + history };
}

/**
 * Packs a prompt into the budget: instructions and memory as they are (each within its share), and
 * as much of the newest history as fits the rest. Deterministic: the same prompt packs the same way.
 */
export function packModelContext(budget: ContextBudget, parts: ContextParts): ContextPacking {
  const whole = tokensOf(parts, sum(parts.history.map((message) => message.tokens)), 0);
  const historyLimitTokens = budget.capTokens - whole.instructions - whole.tools - whole.memory;
  const overBudget = (part: OverBudgetPart): ContextOverBudget => ({ kind: "over_budget", part, tokens: whole, historyLimitTokens });
  if (whole.instructions + whole.tools > budget.split.instructions) return overBudget("instructions");
  if (whole.memory > budget.split.memory) return overBudget("memory");

  const { preamble, exchanges } = exchangesOf(parts.history);
  const current = exchanges.at(-1) ?? [];
  let keptFrom = exchanges.length - 1;
  let used = sum([...preamble, ...current].map((message) => message.tokens));
  if (used > historyLimitTokens) return overBudget("history");

  // Newest first, keep whole exchanges while they and the summary of everything older still fit.
  for (let candidate = exchanges.length - 2; candidate >= 0; candidate -= 1) {
    const cost = sum((exchanges[candidate] ?? []).map((message) => message.tokens));
    const older = exchanges.slice(0, candidate).flat();
    const summaryCost = older.length === 0 ? 0 : (fittingSummary(older, historyLimitTokens - used - cost)?.tokens ?? Number.POSITIVE_INFINITY);
    if (used + cost + summaryCost > historyLimitTokens) break;
    used += cost;
    keptFrom = candidate;
  }

  const dropped = exchanges.slice(0, Math.max(0, keptFrom)).flat();
  const kept = [...preamble, ...exchanges.slice(Math.max(0, keptFrom)).flat()];
  const summary = dropped.length === 0 ? undefined : fittingSummary(dropped, historyLimitTokens - used);
  const firstKept = Math.min(...exchanges.slice(Math.max(0, keptFrom)).flat().map((message) => message.index), ...parts.memory.map((message) => message.index));
  const summaryTokens = summary?.tokens ?? 0;
  return {
    kind: "packed",
    kept,
    dropped,
    ...(summary === undefined ? {} : { summary: { ...summary, insertBefore: firstKept } }),
    tokens: tokensOf(parts, used + summaryTokens, summaryTokens),
    historyLimitTokens,
  };
}
