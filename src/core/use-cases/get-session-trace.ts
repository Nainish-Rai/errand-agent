import type { TraceEvent, TraceSink, TraceSpan, TraceValue } from "../ports/trace-sink";

export interface TraceTotals {
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly modelCalls: number;
  readonly toolCalls: number;
  readonly errors: number;
  /** From the first span's start to the last span's end (or the latest start while running). */
  readonly durationMs: number;
}

export interface SessionTrace {
  readonly sessionId: string;
  readonly spans: readonly TraceSpan[];
  readonly events: readonly TraceEvent[];
  readonly totals: TraceTotals;
}

function numberAt(span: TraceSpan, key: string): number {
  const value: TraceValue | undefined = span.attributes[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function totalsOf(spans: readonly TraceSpan[]): TraceTotals {
  const models = spans.filter((span) => span.kind === "model");
  const starts = spans.map((span) => span.startTimeMs);
  const ends = spans.map((span) => span.endTimeMs ?? span.startTimeMs);
  return {
    costUsd: models.reduce((sum, span) => sum + numberAt(span, "errand.cost.usd"), 0),
    inputTokens: models.reduce((sum, span) => sum + numberAt(span, "gen_ai.usage.input_tokens"), 0),
    outputTokens: models.reduce((sum, span) => sum + numberAt(span, "gen_ai.usage.output_tokens"), 0),
    modelCalls: models.length,
    toolCalls: spans.filter((span) => span.kind === "tool").length,
    errors: spans.filter((span) => span.status === "error" && span.kind !== "agent").length,
    durationMs: spans.length === 0 ? 0 : Math.max(...ends) - Math.min(...starts),
  };
}

/** The trace of a session as it stands now: the latest record of each span, in start order. */
export async function getSessionTrace(sink: TraceSink, sessionId: string): Promise<SessionTrace> {
  const records = await sink.read(sessionId);
  const spans = new Map<string, TraceSpan>();
  const events: TraceEvent[] = [];
  for (const record of records) {
    if (record.type === "event") {
      events.push(record);
      continue;
    }
    // A span's start and end are written by handlers eve may run concurrently, so a late
    // "running" record never reopens a span that has already ended.
    const current = spans.get(record.spanId);
    if (current === undefined || current.status === "running" || record.status !== "running") {
      spans.set(record.spanId, record);
    }
  }
  const ordered = [...spans.values()].sort((a, b) => a.startTimeMs - b.startTimeMs);
  return { sessionId, spans: ordered, events, totals: totalsOf(ordered) };
}
