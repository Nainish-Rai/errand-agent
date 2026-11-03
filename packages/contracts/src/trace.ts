import { z } from "zod";

// The run trace on the wire: GET /api/v1/sessions/:sessionId/trace. Span names and attribute keys
// follow the OpenTelemetry GenAI conventions (`invoke_agent`, `chat`, `execute_tool`, `gen_ai.*`);
// our own attributes use `errand.*`.

/** eve session ids, e.g. `wrun_01M6F677NS5JJZSGR24Z2B9QCK`. Anything else can't name a trace file. */
export const SessionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, "Not a session id.");

export const TraceSpanKindSchema = z.enum(["agent", "step", "model", "tool"]);
export const TraceSpanStatusSchema = z.enum(["running", "ok", "error"]);
export const TraceEventKindSchema = z.enum([
  "state_transition",
  "context",
  "run_outcome",
  "memory_used",
  "errand_drafted",
  "ledger_transition",
  "generated_ui",
]);

const TraceAttributesSchema = z.record(z.string(), z.json());

export const TraceSpanSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  parentSpanId: z.string().optional(),
  sessionId: z.string(),
  kind: TraceSpanKindSchema,
  name: z.string(),
  status: TraceSpanStatusSchema,
  startTimeMs: z.number(),
  endTimeMs: z.number().optional(),
  durationMs: z.number().optional(),
  attributes: TraceAttributesSchema,
});

export const TraceEventSchema = z.object({
  traceId: z.string(),
  eventId: z.string(),
  sessionId: z.string(),
  spanId: z.string().optional(),
  kind: TraceEventKindSchema,
  name: z.string(),
  timeMs: z.number(),
  attributes: TraceAttributesSchema,
});

export const TraceTotalsSchema = z.object({
  costUsd: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  modelCalls: z.number(),
  toolCalls: z.number(),
  errors: z.number(),
  durationMs: z.number(),
});

export const GetSessionTraceResponseSchema = z.object({
  sessionId: z.string(),
  /** Server time when the trace was read, so a client can place running spans on its own clock. */
  generatedAtMs: z.number(),
  spans: z.array(TraceSpanSchema),
  events: z.array(TraceEventSchema),
  totals: TraceTotalsSchema,
});

export type TraceSpanKind = z.infer<typeof TraceSpanKindSchema>;
export type TraceSpanView = z.infer<typeof TraceSpanSchema>;
export type TraceEventView = z.infer<typeof TraceEventSchema>;
export type TraceTotals = z.infer<typeof TraceTotalsSchema>;
export type GetSessionTraceResponse = z.infer<typeof GetSessionTraceResponseSchema>;
