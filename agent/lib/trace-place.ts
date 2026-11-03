import type { TracePlace } from "../../src/core/errand/errand-workflow";

// The ids the run trace gives its spans. The instrumentation writes the spans; tools use the same
// ids to hang their own trace events (errand state transitions) on the tool call that made them.

export function toolSpanId(sessionId: string, callId: string): string {
  return `tool:${sessionId}:${callId}`;
}

interface ToolCallContext {
  readonly callId: string;
  readonly session: { readonly id: string; readonly parent?: { readonly rootSessionId?: string } | null };
}

/** Where a tool call sits in the run trace: a subagent's calls belong to its root session's trace. */
export function tracePlaceOf(ctx: ToolCallContext): TracePlace {
  return {
    traceId: ctx.session.parent?.rootSessionId ?? ctx.session.id,
    sessionId: ctx.session.id,
    spanId: toolSpanId(ctx.session.id, ctx.callId),
  };
}
