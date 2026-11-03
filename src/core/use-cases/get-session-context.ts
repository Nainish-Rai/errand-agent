import type { ContextSplit, ContextTokens, OverBudgetPart } from "../context/context-budget";
import type { TraceEvent, TraceSink, TraceValue } from "../ports/trace-sink";

// The context log of a session, for the trace panel and the evals: every model call's `model
// context` event, joined with the `memory context` event whose memory text it sent, so each call
// says which facts it carried and why every other fact was left out.

export interface LoggedFact {
  readonly id: string;
  readonly key: string;
  readonly value: string;
  readonly source: string;
  readonly status: string;
  readonly reason: string;
}

export interface LoggedMemory {
  /** The memory text exactly as sent; empty when the call carried none. */
  readonly text: string;
  readonly included: readonly LoggedFact[];
  readonly excluded: readonly LoggedFact[];
  /** The memory clock's time the facts were filtered at; null when the call carried no memory. */
  readonly nowMs: number | null;
}

export interface LoggedMessage {
  readonly index: number;
  readonly role: string;
  readonly fromPerson: boolean;
  readonly tokens: number;
  readonly preview: string;
}

export interface LoggedInstruction {
  readonly kind: string;
  readonly label: string;
  readonly tokens: number;
}

export interface ModelCallContext {
  readonly eventId: string;
  readonly sessionId: string;
  readonly turnId: string;
  /** The chat span of the call, when the trace knew it. */
  readonly spanId: string | null;
  readonly timeMs: number;
  readonly outcome: "sent" | "refused";
  readonly overBudgetPart: OverBudgetPart | null;
  readonly estimator: string;
  readonly capTokens: number;
  readonly split: ContextSplit;
  readonly tokens: ContextTokens;
  readonly historyLimitTokens: number;
  readonly instructions: readonly LoggedInstruction[];
  readonly memory: LoggedMemory;
  readonly history: {
    readonly kept: readonly LoggedMessage[];
    readonly dropped: readonly LoggedMessage[];
    readonly summary: string | null;
  };
  readonly promptSha256: string | null;
}

export interface SessionContext {
  readonly sessionId: string;
  /** Oldest first. */
  readonly calls: readonly ModelCallContext[];
}

type Fields = { readonly [key: string]: TraceValue };

function fieldsOf(value: TraceValue | undefined): Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Fields) : {};
}

function listOf(value: TraceValue | undefined): Fields[] {
  return Array.isArray(value) ? value.map(fieldsOf) : [];
}

function text(value: TraceValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function count(value: TraceValue | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function loggedFact(fields: Fields): LoggedFact {
  return {
    id: text(fields.id),
    key: text(fields.key),
    value: text(fields.value),
    source: text(fields.source),
    status: text(fields.status),
    reason: text(fields.reason),
  };
}

function loggedMessage(fields: Fields): LoggedMessage {
  return {
    index: count(fields.index),
    role: text(fields.role),
    fromPerson: fields.from_person === true,
    tokens: count(fields.tokens),
    preview: text(fields.preview),
  };
}

function tokensOf(value: TraceValue | undefined): ContextTokens {
  const fields = fieldsOf(value);
  return {
    instructions: count(fields.instructions),
    tools: count(fields.tools),
    memory: count(fields.memory),
    history: count(fields.history),
    summary: count(fields.summary),
    total: count(fields.total),
  };
}

function splitOf(value: TraceValue | undefined): ContextSplit {
  const fields = fieldsOf(value);
  return { instructions: count(fields.instructions), memory: count(fields.memory), history: count(fields.history) };
}

function overBudgetPart(value: TraceValue | undefined): OverBudgetPart | null {
  return value === "instructions" || value === "memory" || value === "history" ? value : null;
}

/** The memory selection whose text the call sent: the latest one recorded in its session before the call. */
function memoryOf(call: TraceEvent, memoryEvents: readonly TraceEvent[]): LoggedMemory {
  const sent = text(call.attributes["errand.context.memory_text"]);
  const selection = sent === "" ? undefined : memoryEvents.findLast((event) => event.sessionId === call.sessionId && event.timeMs <= call.timeMs);
  if (selection === undefined) return { text: sent, included: [], excluded: [], nowMs: null };
  return {
    text: sent,
    included: listOf(selection.attributes["errand.memory.included"]).map(loggedFact),
    excluded: listOf(selection.attributes["errand.memory.excluded"]).map(loggedFact),
    nowMs: typeof selection.attributes["errand.memory.now_ms"] === "number" ? selection.attributes["errand.memory.now_ms"] : null,
  };
}

function callOf(event: TraceEvent, memoryEvents: readonly TraceEvent[]): ModelCallContext {
  const { attributes } = event;
  const summary = attributes["errand.context.history.summary"];
  const digest = attributes["errand.context.prompt_sha256"];
  return {
    eventId: event.eventId,
    sessionId: event.sessionId,
    turnId: text(attributes["errand.turn.id"]),
    spanId: event.spanId ?? null,
    timeMs: event.timeMs,
    outcome: attributes["errand.context.outcome"] === "refused" ? "refused" : "sent",
    overBudgetPart: overBudgetPart(attributes["errand.context.over_budget_part"]),
    estimator: text(attributes["errand.context.estimator"]),
    capTokens: count(attributes["errand.context.cap_tokens"]),
    split: splitOf(attributes["errand.context.split"]),
    tokens: tokensOf(attributes["errand.context.tokens"]),
    historyLimitTokens: count(attributes["errand.context.history_limit_tokens"]),
    instructions: listOf(attributes["errand.context.instructions"]).map((fields) => ({
      kind: text(fields.kind),
      label: text(fields.label),
      tokens: count(fields.tokens),
    })),
    memory: memoryOf(event, memoryEvents),
    history: {
      kept: listOf(attributes["errand.context.history.kept"]).map(loggedMessage),
      dropped: listOf(attributes["errand.context.history.dropped"]).map(loggedMessage),
      summary: typeof summary === "string" ? summary : null,
    },
    promptSha256: typeof digest === "string" ? digest : null,
  };
}

export async function getSessionContext(sink: TraceSink, sessionId: string): Promise<SessionContext> {
  const events = (await sink.read(sessionId)).filter((record): record is TraceEvent => record.type === "event" && record.kind === "context");
  const memoryEvents = events.filter((event) => event.name === "memory context");
  const calls = events.filter((event) => event.name === "model context").map((event) => callOf(event, memoryEvents));
  return { sessionId, calls };
}
