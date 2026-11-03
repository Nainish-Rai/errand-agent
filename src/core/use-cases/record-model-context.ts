import type { ContextBudget, ContextPacking, ContextParts, HistoryMessage } from "../context/context-budget";
import { BYTES_PER_TOKEN } from "../context/token-estimate";
import type { TracePlace } from "../errand/errand-workflow";
import type { Clock } from "../ports/clock";
import type { TraceEvent, TraceSink, TraceValue } from "../ports/trace-sink";

// The context log: one `model context` event per model call, written by the model wrapper before
// the call goes out (or instead of it, when the context is refused). It says what was sent: each
// part's tokens against the cap and the split, every instruction block, the exact memory text, the
// history kept and dropped (with a preview of each message) and the summary that replaced the
// dropped part. The turn's `memory context` event says which facts that memory text holds and why
// the others were left out.

export interface RecordModelContextDependencies {
  readonly traceSink: TraceSink;
  readonly clock: Clock;
}

export interface RecordModelContextRequest {
  /** The chat span of the call when the trace knows it. */
  readonly place: TracePlace;
  readonly turnId: string;
  readonly budget: ContextBudget;
  readonly parts: ContextParts;
  readonly packing: ContextPacking;
  /** SHA-256 of the prompt exactly as sent (absent when it was refused). */
  readonly promptSha256?: string;
}

export const CONTEXT_ESTIMATOR = `utf8_bytes/${BYTES_PER_TOKEN}`;

const PREVIEW_CHARACTERS = 160;

function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= PREVIEW_CHARACTERS ? flat : `${flat.slice(0, PREVIEW_CHARACTERS - 1)}…`;
}

function historyEntry(message: HistoryMessage): TraceValue {
  return { index: message.index, role: message.role, from_person: message.fromPerson, tokens: message.tokens, preview: preview(message.text) };
}

function attributesOf(request: RecordModelContextRequest): Record<string, TraceValue> {
  const { budget, parts, packing } = request;
  const common: Record<string, TraceValue> = {
    "errand.turn.id": request.turnId,
    "errand.context.estimator": CONTEXT_ESTIMATOR,
    "errand.context.cap_tokens": budget.capTokens,
    "errand.context.split": { ...budget.split },
    "errand.context.tokens": { ...packing.tokens },
    "errand.context.history_limit_tokens": packing.historyLimitTokens,
    "errand.context.instructions": parts.instructions.map((block) => ({ kind: block.kind, label: block.label, tokens: block.tokens })),
    "errand.context.memory_text": parts.memory.map((message) => message.text).join("\n\n"),
  };
  if (packing.kind === "over_budget") {
    return {
      ...common,
      "errand.context.outcome": "refused",
      "errand.context.over_budget_part": packing.part,
      "errand.context.history.kept": [],
      "errand.context.history.dropped": parts.history.map(historyEntry),
      "errand.context.history.summary": null,
    };
  }
  return {
    ...common,
    "errand.context.outcome": "sent",
    "errand.context.history.kept": packing.kept.map(historyEntry),
    "errand.context.history.dropped": packing.dropped.map(historyEntry),
    "errand.context.history.summary": packing.summary?.text ?? null,
    ...(request.promptSha256 === undefined ? {} : { "errand.context.prompt_sha256": request.promptSha256 }),
  };
}

export async function recordModelContext(deps: RecordModelContextDependencies, request: RecordModelContextRequest): Promise<void> {
  const { place } = request;
  const atMs = deps.clock.now().getTime();
  await deps.traceSink.record({
    type: "event",
    traceId: place.traceId,
    eventId: `${place.sessionId}:model-context:${place.spanId ?? `${request.turnId}:${atMs}`}`,
    sessionId: place.sessionId,
    ...(place.spanId === undefined ? {} : { spanId: place.spanId }),
    kind: "context",
    name: "model context",
    timeMs: atMs,
    attributes: attributesOf(request),
  } satisfies TraceEvent);
}
