// The run trace, as core sees it. One trace per root session: every turn, model call and tool
// call of that session (and of any subagent it dispatches) lands in it. Span names and attribute
// keys follow the OpenTelemetry GenAI conventions (`gen_ai.*`); our own keys use `errand.*`.

export type TraceValue = string | number | boolean | null | readonly TraceValue[] | { readonly [key: string]: TraceValue };

export type TraceAttributes = Readonly<Record<string, TraceValue>>;

/** `agent` is one turn (`invoke_agent`), `step` one model run inside it (`agent.step`). */
export type TraceSpanKind = "agent" | "step" | "model" | "tool";

export type TraceSpanStatus = "running" | "ok" | "error";

export interface TraceSpan {
  readonly type: "span";
  /** The root session the span belongs to; a subagent's spans share its parent's trace. */
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  /** The session that did the work, which differs from `traceId` inside a subagent. */
  readonly sessionId: string;
  readonly kind: TraceSpanKind;
  readonly name: string;
  readonly status: TraceSpanStatus;
  readonly startTimeMs: number;
  readonly endTimeMs?: number;
  readonly durationMs?: number;
  readonly attributes: TraceAttributes;
}

/**
 * A point in time worth explaining, attached to the trace rather than to one call: errand state
 * transitions (ticket 04), how each run ended (ticket 08), the context sent to the model (tickets 11
 * and 12), a remembered fact filling in the errand (ticket 11), the home composer's chips filling
 * it in before the first model turn (ticket 13), every change of an action intent in the ledger
 * (ticket 07), how a generated-UI program was judged, parse errors included (ticket 17), and a
 * provider event the backend received (ticket 14).
 */
export type TraceEventKind =
  | "state_transition"
  | "context"
  | "run_outcome"
  | "memory_used"
  | "errand_drafted"
  | "ledger_transition"
  | "generated_ui"
  | "provider_event";

export interface TraceEvent {
  readonly type: "event";
  readonly traceId: string;
  readonly eventId: string;
  readonly sessionId: string;
  /** The span the event happened inside, when there is one. */
  readonly spanId?: string;
  readonly kind: TraceEventKind;
  readonly name: string;
  readonly timeMs: number;
  readonly attributes: TraceAttributes;
}

export type TraceRecord = TraceSpan | TraceEvent;

/**
 * Append-only. A span is written when it starts and again when it ends; the later finished record
 * with the same `spanId` wins, so readers see running spans while the run is still going.
 */
export interface TraceSink {
  record(record: TraceRecord): Promise<void>;
  /** Every record of the trace in write order; empty when the trace doesn't exist yet. */
  read(traceId: string): Promise<readonly TraceRecord[]>;
}
