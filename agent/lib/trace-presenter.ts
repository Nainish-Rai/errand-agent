import type { GetSessionTraceResponse, TraceEventView, TraceSpanView } from "@errand/contracts";

import type { TraceEvent, TraceSpan } from "../../src/core/ports/trace-sink";
import type { SessionTrace } from "../../src/core/use-cases/get-session-trace";

// Core trace types to the wire shape of GET /api/v1/sessions/:sessionId/trace.

function presentSpan({ type: _type, ...span }: TraceSpan): TraceSpanView {
  return { ...span, attributes: { ...span.attributes } } as TraceSpanView;
}

function presentEvent({ type: _type, ...event }: TraceEvent): TraceEventView {
  return { ...event, attributes: { ...event.attributes } } as TraceEventView;
}

export function presentSessionTrace(trace: SessionTrace, generatedAtMs: number): GetSessionTraceResponse {
  return {
    sessionId: trace.sessionId,
    generatedAtMs,
    spans: trace.spans.map(presentSpan),
    events: trace.events.map(presentEvent),
    totals: { ...trace.totals },
  };
}
