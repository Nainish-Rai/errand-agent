import type { GetSessionTraceResponse, TraceSpanView } from "@errand/contracts";

import type { TraceSpan } from "@/components/agents/trace-waterfall";

// The session trace (OTel GenAI spans in milliseconds) as the waterfall's spans (seconds from the
// first span). `agent.step` spans are folded away: their model and tool calls hang straight off the
// turn, which reads better in a narrow panel. Every value here was sanitised before it was written.

const PREVIEW_CHARS = 600;

export interface WaterfallTrace {
  readonly spans: TraceSpan[];
  /** Wall-clock milliseconds of trace time 0. */
  readonly originMs: number;
  /** Trace seconds at which the last finished span ended. */
  readonly endSeconds: number;
  readonly running: boolean;
}

function numberAt(span: TraceSpanView, key: string): number | undefined {
  const value = span.attributes[key];
  return typeof value === "number" ? value : undefined;
}

function stringAt(span: TraceSpanView, key: string): string | undefined {
  const value = span.attributes[key];
  return typeof value === "string" ? value : undefined;
}

function preview(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 1);
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
}

interface OutputPart {
  readonly type?: string;
  readonly content?: string;
  readonly name?: string;
}

/** The model's reply in a few lines: its text, then the tools it asked for. */
function replyOf(span: TraceSpanView): string | undefined {
  const messages = span.attributes["gen_ai.output.messages"];
  if (!Array.isArray(messages)) return undefined;
  const parts = messages.flatMap((message) =>
    typeof message === "object" && message !== null && "parts" in message && Array.isArray(message.parts)
      ? (message.parts as OutputPart[])
      : [],
  );
  const text = parts.flatMap((part) => (part.type === "text" && part.content ? [part.content] : []));
  const calls = parts.flatMap((part) => (part.type === "tool_call" && part.name ? [`→ ${part.name}`] : []));
  return preview([...text, ...calls].join("\n"));
}

/** Each span's parent once `agent.step` spans are taken out of the tree. */
function parentsWithoutSteps(spans: readonly TraceSpanView[]): Map<string, string | undefined> {
  const steps = new Map(spans.filter((span) => span.kind === "step").map((span) => [span.spanId, span.parentSpanId]));
  return new Map(
    spans.map((span) => {
      let parent = span.parentSpanId;
      while (parent !== undefined && steps.has(parent)) parent = steps.get(parent);
      return [span.spanId, parent];
    }),
  );
}

function toWaterfallSpan(span: TraceSpanView, parentId: string | undefined, originMs: number): TraceSpan {
  const seconds = (ms: number) => (ms - originMs) / 1000;
  const base = {
    id: span.spanId,
    parentId,
    start: seconds(span.startTimeMs),
    end: span.endTimeMs === undefined ? undefined : seconds(span.endTimeMs),
    status: span.status === "running" ? undefined : span.status,
  };
  switch (span.kind) {
    case "agent":
      return {
        ...base,
        kind: "agent",
        tone: "blue",
        name: `Turn ${(numberAt(span, "errand.turn.sequence") ?? 0) + 1}`,
        subtitle: stringAt(span, "gen_ai.agent.name"),
        output: stringAt(span, "errand.turn.outcome"),
      };
    case "model":
      return {
        ...base,
        kind: "llm",
        name: "chat",
        subtitle: stringAt(span, "gen_ai.response.model") ?? stringAt(span, "gen_ai.request.model"),
        tokensIn: numberAt(span, "gen_ai.usage.input_tokens"),
        tokensOut: numberAt(span, "gen_ai.usage.output_tokens"),
        cost: numberAt(span, "errand.cost.usd"),
        input: `${numberAt(span, "errand.input.message_count") ?? "?"} messages`,
        output: replyOf(span) ?? stringAt(span, "error.type"),
      };
    default:
      return {
        ...base,
        kind: "tool",
        name: stringAt(span, "gen_ai.tool.name") ?? span.name,
        subtitle: "tool",
        input: preview(span.attributes["gen_ai.tool.call.arguments"]),
        output: preview(span.attributes["gen_ai.tool.call.result"] ?? span.attributes["error.type"]),
      };
  }
}

export function toWaterfallTrace(trace: GetSessionTraceResponse): WaterfallTrace {
  const { spans } = trace;
  const originMs = spans.length === 0 ? trace.generatedAtMs : Math.min(...spans.map((span) => span.startTimeMs));
  const parents = parentsWithoutSteps(spans);
  const ends = spans.map((span) => span.endTimeMs ?? span.startTimeMs);
  return {
    spans: spans
      .filter((span) => span.kind !== "step")
      .map((span) => toWaterfallSpan(span, parents.get(span.spanId), originMs)),
    originMs,
    endSeconds: spans.length === 0 ? 0 : (Math.max(...ends) - originMs) / 1000,
    running: spans.some((span) => span.status === "running"),
  };
}
