import {
  defineInstrumentation,
  type InstrumentationContext,
  type InstrumentationEvent,
  type InstrumentationScope,
} from "eve/instrumentation";

import { container } from "../../src/composition/container";
import type { TraceAttributes, TraceSpan, TraceValue } from "../../src/core/ports/trace-sink";
import { toolSpanId } from "../lib/trace-place";

// Writes every run to the JSONL trace: one `invoke_agent` span per turn, an `agent.step` span per
// model run, a `chat` span per provider call and an `execute_tool` span per tool call, the same
// topology and `gen_ai.*` attribute names eve's own OpenTelemetry spans use.
//
// Why lifecycle events and not an OTel span processor: eve hands a span processor a child span
// only once its parent has ended, so a processor would see the whole turn at once when it
// finishes. These events arrive as each call starts and settles, which is what lets the trace
// panel show the run while it is going. Each span is written when it starts and again when it
// settles; the sink sanitises every record before it reaches the file.

type ModelReply = Extract<InstrumentationEvent<"model.call.settled">, { readonly outcome: "completed" }>["content"];
type StoredState = Parameters<InstrumentationContext["state"]["set"]>[0];

const AGENT_NAME_FALLBACK = "errand-agent";

/** Every span time comes from the container's wall clock, the one the trace route reads "now" from. */
function wallNow(): number {
  return container().wallClock.now().getTime();
}

function turnSpanId(sessionId: string, turnId: string): string {
  return `turn:${sessionId}:${turnId}`;
}

function stepSpanId(scope: InstrumentationScope): string {
  return `step:${scope.sessionId}:${scope.runId}:${scope.attempt}`;
}

function errorType(error: unknown): string {
  if (typeof error === "object" && error !== null && "name" in error && typeof error.name === "string") return error.name;
  return "Error";
}

function errorMessage(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return typeof error === "string" ? error : undefined;
}

/** Tool results arrive JSON-encoded; decode them so the sanitiser and the panel see fields. */
function decoded(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/** Drops absent attributes. The sink sanitises and normalises every value that is left. */
function defined(attributes: Record<string, unknown>): TraceAttributes {
  const kept: Record<string, TraceValue> = {};
  for (const [key, value] of Object.entries(attributes)) if (value !== undefined) kept[key] = value as TraceValue;
  return kept;
}

/** The model's reply in the GenAI conventions' output-message shape. */
function outputMessages(content: ModelReply): unknown {
  if (content === undefined) return undefined;
  const parts = content.flatMap((part): Record<string, unknown>[] => {
    if (part.type === "text") return [{ type: "text", content: part.text }];
    if (part.type === "reasoning") return [{ type: "reasoning", content: part.text }];
    if (part.type === "tool-call") return [{ type: "tool_call", id: part.callId, name: part.toolName, arguments: part.input }];
    return [];
  });
  return [{ role: "assistant", parts }];
}

/** Records the span as running and keeps it in eve's durable per-operation state for its end. */
function open(span: TraceSpan, ctx: InstrumentationContext): Promise<void> {
  ctx.state.set(span as unknown as StoredState);
  return container().traceSink.record(span);
}

function opened(ctx: InstrumentationContext): TraceSpan | undefined {
  return ctx.state.get() as unknown as TraceSpan | undefined;
}

interface SpanEnding {
  readonly status: "ok" | "error";
  readonly endTimeMs?: number;
  readonly attributes: Record<string, unknown>;
}

function close(ctx: InstrumentationContext, ending: SpanEnding): Promise<void> {
  const span = opened(ctx);
  ctx.state.set(undefined);
  if (span === undefined) return Promise.resolve();
  const endTimeMs = Math.max(span.startTimeMs, ending.endTimeMs ?? wallNow());
  return container().traceSink.record({
    ...span,
    status: ending.status,
    endTimeMs,
    durationMs: endTimeMs - span.startTimeMs,
    attributes: { ...span.attributes, ...defined(ending.attributes) },
  });
}

function closeModelCall(event: InstrumentationEvent<"model.call.settled">, ctx: InstrumentationContext): Promise<void> {
  if (event.outcome === "failed") {
    return close(ctx, {
      status: "error",
      attributes: { "error.type": errorType(event.error), "errand.error.message": errorMessage(event.error) },
    });
  }
  const requested = opened(ctx)?.attributes["gen_ai.request.model"];
  const usage = {
    inputTokens: event.usage.inputTokens,
    outputTokens: event.usage.outputTokens,
    cacheReadTokens: event.usage.inputTokenDetails?.cacheReadTokens,
    cacheWriteTokens: event.usage.inputTokenDetails?.cacheWriteTokens,
  };
  const cost = container().modelPricing.costOf({
    modelId: event.responseModelId ?? (typeof requested === "string" ? requested : ""),
    usage,
    reportedCostUsd: event.usage.costUsd,
    providerMetadata: event.providerMetadata,
  });
  return close(ctx, {
    status: "ok",
    attributes: {
      "gen_ai.response.model": event.responseModelId,
      "gen_ai.response.id": event.responseId,
      "gen_ai.response.finish_reasons": [event.finishReason],
      "gen_ai.usage.input_tokens": usage.inputTokens,
      "gen_ai.usage.output_tokens": usage.outputTokens,
      "gen_ai.usage.cache_read.input_tokens": usage.cacheReadTokens,
      "gen_ai.usage.cache_creation.input_tokens": usage.cacheWriteTokens,
      "gen_ai.output.messages": outputMessages(event.content),
      "errand.cost.usd": cost?.usd,
      "errand.cost.source": cost?.source,
    },
  });
}

export default defineInstrumentation({
  // Local development keeps content; the sink strips phones, emails and keys before writing.
  tracePolicy: () => ({ emit: true, recordInputs: true, recordOutputs: true }),
  events: {
    "turn.started": (event, ctx) => {
      const parent = event.parentLineage;
      const agentName = event.agentName ?? AGENT_NAME_FALLBACK;
      return open(
        {
          type: "span",
          traceId: event.rootSessionId,
          spanId: turnSpanId(event.sessionId, event.turnId),
          // A subagent's turn hangs off the tool call that dispatched it.
          parentSpanId: parent === undefined ? undefined : toolSpanId(parent.sessionId, parent.callId),
          sessionId: event.sessionId,
          kind: "agent",
          name: `invoke_agent ${agentName}`,
          status: "running",
          startTimeMs: wallNow(),
          attributes: defined({
            "gen_ai.operation.name": "invoke_agent",
            "gen_ai.agent.name": agentName,
            "gen_ai.conversation.id": event.rootSessionId,
            "errand.turn.id": event.turnId,
            "errand.turn.sequence": event.sequence,
            "errand.subagent.name": parent?.subagentName,
          }),
        },
        ctx,
      );
    },

    "turn.settled": (event, ctx) =>
      close(ctx, {
        status: event.outcome === "failed" ? "error" : "ok",
        attributes: {
          "errand.turn.outcome": event.outcome,
          "error.type": event.outcome === "failed" ? errorType(event.error) : undefined,
          "errand.error.message": event.outcome === "failed" ? errorMessage(event.error) : undefined,
        },
      }),

    "model.started": (event, ctx) => {
      const { scope } = event;
      return open(
        {
          type: "span",
          traceId: scope.rootSessionId,
          spanId: stepSpanId(scope),
          parentSpanId: scope.turnId === undefined ? undefined : turnSpanId(scope.sessionId, scope.turnId),
          sessionId: scope.sessionId,
          kind: "step",
          name: "agent.step",
          status: "running",
          startTimeMs: wallNow(),
          attributes: defined({
            "gen_ai.request.model": event.operation.modelId,
            "gen_ai.provider.name": event.operation.provider,
            "errand.run.id": scope.runId,
            "errand.run.attempt": scope.attempt,
          }),
        },
        ctx,
      );
    },

    "model.retried": (event, ctx) =>
      close(ctx, {
        status: "error",
        attributes: { "error.type": errorType(event.error), "errand.step.outcome": "retried" },
      }),

    "model.settled": (event, ctx) =>
      close(ctx, {
        status: event.outcome === "completed" || event.outcome === "cancelled" ? "ok" : "error",
        attributes: {
          "errand.step.outcome": event.outcome,
          "error.type": event.error === undefined ? undefined : errorType(event.error),
        },
      }),

    "model.call.started": (event, ctx) => {
      const { scope } = event;
      return open(
        {
          type: "span",
          traceId: scope.rootSessionId,
          // Unique per provider call and stable across replays; the start and the end share it.
          spanId: event.idempotencyKey,
          parentSpanId: stepSpanId(scope),
          sessionId: scope.sessionId,
          kind: "model",
          name: `chat ${event.model.modelId}`,
          status: "running",
          startTimeMs: wallNow(),
          attributes: defined({
            "gen_ai.operation.name": "chat",
            "gen_ai.provider.name": event.model.provider,
            "gen_ai.request.model": event.model.modelId,
            "errand.input.message_count": event.input?.messages.length,
            "errand.input.tool_count": event.input?.tools?.length,
          }),
        },
        ctx,
      );
    },

    "model.call.settled": closeModelCall,

    "call.requested": (event, ctx) => {
      const { scope } = event;
      return open(
        {
          type: "span",
          traceId: scope.rootSessionId,
          spanId: toolSpanId(scope.sessionId, event.callId),
          parentSpanId: stepSpanId(scope),
          sessionId: scope.sessionId,
          kind: "tool",
          name: `execute_tool ${event.toolName}`,
          status: "running",
          startTimeMs: event.startedAtMs ?? wallNow(),
          attributes: defined({
            "gen_ai.operation.name": "execute_tool",
            "gen_ai.tool.name": event.toolName,
            "gen_ai.tool.call.id": event.callId,
            "gen_ai.tool.type": event.capability.kind === "tool" ? "function" : event.capability.kind,
            "gen_ai.tool.call.arguments": event.input,
            "errand.tool.framework": event.frameworkTool,
          }),
        },
        ctx,
      );
    },

    "call.settled": (event, ctx) =>
      close(ctx, {
        status: event.outcome === "completed" ? "ok" : "error",
        endTimeMs: event.completedAtMs,
        attributes: {
          "gen_ai.tool.call.result": decoded(event.output),
          "errand.tool.outcome": event.outcome,
          "errand.tool.duration_ms": event.durationMs,
          "error.type": event.outcome === "completed" ? undefined : (event.errorCode ?? errorType(event.error)),
          "errand.error.message": errorMessage(event.error) ?? event.reason,
        },
      }),
  },
});
