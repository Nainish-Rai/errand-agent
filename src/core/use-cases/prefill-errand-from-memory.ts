import type { ErrandField, ErrandPatch } from "../errand/errand";
import type { TracePlace } from "../errand/errand-workflow";
import { selectContext } from "../memory/context-selection";
import { isValueInEvidence, type MemoryFact } from "../memory/memory-fact";
import type { TraceEvent } from "../ports/trace-sink";
import type { ErrandDependencies } from "./errand-session";
import type { MemoryDependencies } from "./memory-session";
import { updateErrand, type ErrandPatchRequest, type UpdateErrandOutcome } from "./update-errand";

// A new errand starts from what the person told the agent before: their usual area, budget and
// preferences. The remembered details go through updateErrand like any other patch, so the change
// is validated, saved and traced the same way, and a `memory_used` event says which facts did it.
// Only a session's first errand is prefilled, and never with a value other than the one the person
// is giving right now. A model that read the remembered area and passes it on is still using memory,
// so that counts as memory unless the person said the value themselves in this session.

export interface PrefillErrandRequest {
  readonly ownerId: string;
  readonly place: TracePlace;
  /** What this same call sets. A different value is the person's choice and wins over memory. */
  readonly setting: ErrandPatchRequest;
  /** The person's own messages in this session, to tell a value they said from one memory supplied. */
  readonly personsWords: readonly string[];
}

/** A remembered fact that filled an errand field. */
export interface RememberedDetail {
  readonly field: ErrandField;
  readonly fact: MemoryFact;
}

export type PrefillErrandOutcome =
  | { readonly kind: "prefilled"; readonly used: readonly RememberedDetail[]; readonly outcome: UpdateErrandOutcome }
  /** The session already has an errand; it was prefilled when it started, if at all. */
  | { readonly kind: "errand_exists" }
  | { readonly kind: "nothing_to_use" }
  /** updateErrand refused the remembered details (an area the catalog no longer covers, say). */
  | { readonly kind: "not_applied"; readonly outcome: UpdateErrandOutcome };

function detailOf(fact: MemoryFact): { readonly field: ErrandField; readonly patch: ErrandPatch } | undefined {
  switch (fact.key) {
    case "area":
      return { field: "area", patch: { area: fact.value } };
    case "budget":
      return { field: "budget", patch: { budget: { maxInr: Number(fact.value) } } };
    case "preferences": {
      const preferences = fact.value.split(",").map((wish) => wish.trim()).filter(Boolean);
      return preferences.length === 0 ? undefined : { field: "preferences", patch: { preferences } };
    }
    // The earliest hour needs the errand's dates and a technician has no errand field: both reach
    // the model through the memory context instead.
    case "earliest_hour":
    case "favourite_technician":
      return undefined;
  }
}

function comparable(value: unknown): string {
  return JSON.stringify(value)?.toLowerCase() ?? "";
}

/** True when the call sets this field to something else, or the person said the value themselves. */
function isThePersonsOwn(
  detail: { readonly field: ErrandField; readonly patch: ErrandPatch },
  fact: MemoryFact,
  request: PrefillErrandRequest,
  resolveArea: (text: string) => string | undefined,
): boolean {
  const set = request.setting[detail.field];
  if (set === undefined) return false;
  const asSet = detail.field === "area" && typeof set === "string" ? (resolveArea(set) ?? set) : set;
  if (comparable(asSet) !== comparable(detail.patch[detail.field])) return true;
  return request.personsWords.some((words) => isValueInEvidence(fact.value, words));
}

function memoryUsedEvent(errandId: string, used: readonly RememberedDetail[], place: TracePlace, atMs: number): TraceEvent {
  return {
    type: "event",
    traceId: place.traceId,
    eventId: `${errandId}:memory-prefill`,
    sessionId: place.sessionId,
    ...(place.spanId === undefined ? {} : { spanId: place.spanId }),
    kind: "memory_used",
    name: `memory → errand: ${used.map(({ field }) => field).join(", ")}`,
    timeMs: atMs,
    attributes: {
      "errand.id": errandId,
      "errand.memory.fields": used.map(({ field }) => field),
      "errand.memory.fact_ids": used.map(({ fact }) => fact.id),
    },
  };
}

export async function prefillErrandFromMemory(
  deps: { readonly errand: ErrandDependencies; readonly memory: MemoryDependencies },
  request: PrefillErrandRequest,
): Promise<PrefillErrandOutcome> {
  if ((await deps.errand.errands.find(request.place.sessionId)) !== undefined) return { kind: "errand_exists" };
  const memory = await deps.memory.memory.read(request.ownerId);
  // Context selection is the one rule for what may be used: only active, valid facts get through.
  const { included } = selectContext(memory.facts, undefined, deps.memory.clock.now().getTime());
  const used: RememberedDetail[] = [];
  let patch: ErrandPatch = {};
  for (const { fact } of included) {
    const detail = detailOf(fact);
    if (detail === undefined || isThePersonsOwn(detail, fact, request, (text) => deps.errand.catalog.resolveArea(text))) continue;
    used.push({ field: detail.field, fact });
    patch = { ...patch, ...detail.patch };
  }
  if (used.length === 0) return { kind: "nothing_to_use" };

  const outcome = await updateErrand(deps.errand, { place: request.place, patch });
  if (outcome.kind !== "updated") return { kind: "not_applied", outcome };
  await deps.errand.traceSink.record(memoryUsedEvent(outcome.errand.errandId, used, request.place, deps.errand.clock.now().getTime()));
  return { kind: "prefilled", used, outcome };
}
