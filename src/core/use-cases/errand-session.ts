import { openErrand, type Errand } from "../errand/errand";
import { transitionEvent, type TracePlace } from "../errand/errand-workflow";
import type { Clock } from "../ports/clock";
import type { ErrandStore } from "../ports/errand-store";
import type { ServiceCatalog } from "../ports/service-catalog";
import type { TraceSink } from "../ports/trace-sink";

// What every errand use case works with: the session's errand, the catalog that names valid
// services and areas, and the trace every state change is written to.

export interface ErrandDependencies {
  readonly errands: ErrandStore;
  readonly catalog: ServiceCatalog;
  readonly traceSink: TraceSink;
  /** Stamps transitions; the same clock as the trace's spans, so they line up in the panel. */
  readonly clock: Clock;
}

/** The session's errand, or a new one when the session has none yet. */
export function errandOrNew(current: Errand | undefined, place: TracePlace, clock: Clock): Errand {
  return current ?? openErrand(place.sessionId, clock.now().getTime());
}

/** Writes the transitions `after` has that `before` didn't (all of them for a new errand). */
export async function traceNewTransitions(
  sink: TraceSink,
  before: Errand | undefined,
  after: Errand,
  place: TracePlace,
): Promise<void> {
  const fresh = after.transitions.slice(before?.transitions.length ?? 0);
  for (const transition of fresh) await sink.record(transitionEvent(after.errandId, transition, place));
}
