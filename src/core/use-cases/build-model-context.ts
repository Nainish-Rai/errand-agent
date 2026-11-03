import type { ContextBudget } from "../context/context-budget";
import { estimateMessageTokens } from "../context/token-estimate";
import type { TracePlace } from "../errand/errand-workflow";
import { packSelection, selectContext, type ContextSelection } from "../memory/context-selection";
import type { MemoryFact } from "../memory/memory-fact";
import type { Clock } from "../ports/clock";
import type { ErrandStore } from "../ports/errand-store";
import type { MemoryStore } from "../ports/memory-store";
import type { TraceEvent, TraceSink } from "../ports/trace-sink";

// The remembered part of the model's context for one turn: filter the person's facts, rank them
// by relevance to the session's errand, then pack the best of them into the memory share of the
// context budget. Every turn's selection is written to the run trace with what was included and
// what was excluded, each with its reason, so a reviewer can see that a forgotten or unconfirmed
// fact never reached the model.

export interface ModelContextDependencies {
  readonly memory: MemoryStore;
  readonly errands: ErrandStore;
  readonly traceSink: TraceSink;
  readonly budget: ContextBudget;
  /** Opens and closes validity windows: the same clock the memory use cases stamp facts with. */
  readonly clock: Clock;
  /** Stamps the trace event, like every other trace time. */
  readonly wallClock: Clock;
}

export interface BuildModelContextRequest {
  readonly ownerId: string;
  readonly place: TracePlace;
  readonly turnId: string;
  /** The memory message the model reads, from the agent's presenter; packing measures it. */
  readonly render: (selection: ContextSelection) => string;
}

export interface ModelContext {
  readonly selection: ContextSelection;
  /** The memory message, as rendered from the packed selection. */
  readonly text: string;
  readonly tokens: number;
  /** False when nothing was ever stored about the person, so there is nothing to say at all. */
  readonly remembersAnything: boolean;
}

/** The heading the memory context starts with, so any reader (the offline model included) can tell it from a person's message. */
export const MEMORY_CONTEXT_HEADING = "Remembered about this person";

function entry(fact: MemoryFact, reason: string): Record<string, string> {
  return { id: fact.id, key: fact.key, value: fact.value, source: fact.source, status: fact.status, reason };
}

function contextEvent(context: ModelContext, request: BuildModelContextRequest, budget: ContextBudget, nowMs: number, atMs: number): TraceEvent {
  const { place } = request;
  const { selection } = context;
  return {
    type: "event",
    traceId: place.traceId,
    eventId: `${place.sessionId}:memory-context:${request.turnId}`,
    sessionId: place.sessionId,
    ...(place.spanId === undefined ? {} : { spanId: place.spanId }),
    kind: "context",
    name: "memory context",
    timeMs: atMs,
    attributes: {
      "errand.turn.id": request.turnId,
      "errand.context.facts": selection.included.length,
      "errand.memory.included": selection.included.map(({ fact, reason }) => entry(fact, reason)),
      "errand.memory.excluded": selection.excluded.map(({ fact, reason }) => entry(fact, reason)),
      // The memory clock's "now" the filter used: validity windows are judged against it.
      "errand.memory.now_ms": nowMs,
      "errand.memory.tokens": context.tokens,
      "errand.memory.share_tokens": budget.split.memory,
      "errand.memory.text": context.text,
    },
  };
}

export async function buildModelContext(deps: ModelContextDependencies, request: BuildModelContextRequest): Promise<ModelContext> {
  const memory = await deps.memory.read(request.ownerId);
  const errand = await deps.errands.find(request.place.sessionId);
  const nowMs = deps.clock.now().getTime();
  const share = deps.budget.split.memory;
  const selection = packSelection(selectContext(memory.facts, errand?.details, nowMs), (packed) => estimateMessageTokens(request.render(packed)) <= share);
  const text = request.render(selection);
  const context: ModelContext = {
    selection,
    text,
    tokens: estimateMessageTokens(text),
    remembersAnything: memory.facts.length > 0 || memory.tombstones.length > 0,
  };
  if (context.remembersAnything) await deps.traceSink.record(contextEvent(context, request, deps.budget, nowMs, deps.wallClock.now().getTime()));
  return context;
}
