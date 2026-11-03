import type { TracePlace } from "../errand/errand-workflow";
import { selectContext, type ContextSelection } from "../memory/context-selection";
import type { Clock } from "../ports/clock";
import type { ErrandStore } from "../ports/errand-store";
import type { MemoryStore } from "../ports/memory-store";
import type { TraceEvent, TraceSink } from "../ports/trace-sink";

// The remembered part of the model's context for one turn: context selection over the person's
// facts and the session's errand. Every turn's selection is written to the run trace with what was
// included and what was excluded, each with its reason, so a reviewer can see that a forgotten or
// unconfirmed fact never reached the model.

export interface ModelContextDependencies {
  readonly memory: MemoryStore;
  readonly errands: ErrandStore;
  readonly traceSink: TraceSink;
  /** Opens and closes validity windows: the same clock the memory use cases stamp facts with. */
  readonly clock: Clock;
  /** Stamps the trace event, like every other trace time. */
  readonly wallClock: Clock;
}

export interface BuildModelContextRequest {
  readonly ownerId: string;
  readonly place: TracePlace;
  readonly turnId: string;
}

export interface ModelContext {
  readonly selection: ContextSelection;
  /** False when nothing was ever stored about the person, so there is nothing to say at all. */
  readonly remembersAnything: boolean;
}

/** The heading the memory context starts with, so any reader (the offline model included) can tell it from a person's message. */
export const MEMORY_CONTEXT_HEADING = "Remembered about this person";

function contextEvent(selection: ContextSelection, request: BuildModelContextRequest, atMs: number): TraceEvent {
  const { place } = request;
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
      "errand.context.facts": selection.included.length,
      "errand.memory.included": selection.included.map(({ fact, reason }) => ({ id: fact.id, key: fact.key, reason })),
      "errand.memory.excluded": selection.excluded.map(({ fact, reason }) => ({ id: fact.id, key: fact.key, reason })),
    },
  };
}

export async function buildModelContext(deps: ModelContextDependencies, request: BuildModelContextRequest): Promise<ModelContext> {
  const memory = await deps.memory.read(request.ownerId);
  const errand = await deps.errands.find(request.place.sessionId);
  const selection = selectContext(memory.facts, errand?.details, deps.clock.now().getTime());
  const remembersAnything = memory.facts.length > 0 || memory.tombstones.length > 0;
  if (remembersAnything) await deps.traceSink.record(contextEvent(selection, request, deps.wallClock.now().getTime()));
  return { selection, remembersAnything };
}
