import { dayAfter, istDayOf } from "../calendar/ist-day";
import { EMPTY_DETAILS, patchDetails, type Budget, type Errand, type ErrandField, type ErrandPatch, type HourRange, type InvalidDetailReason } from "../errand/errand";
import type { TracePlace } from "../errand/errand-workflow";
import type { Clock } from "../ports/clock";
import type { TraceEvent } from "../ports/trace-sink";
import type { ErrandDependencies } from "./errand-session";
import { resolveAgainstCatalog, updateErrand } from "./update-errand";

// The home composer's chips (area, budget, time of day) become the errand's details before the
// chat's first model turn, so the agent starts from them and never asks for them. They go through
// updateErrand like any other patch: validated against the catalog, saved and traced, plus one
// `errand_drafted` event that says which fields the composer set. Only a new session is drafted:
// once the person is talking to the agent, their words change the errand, not the home screen.

export interface ErrandDraft {
  readonly area?: string;
  readonly budget?: Budget;
  /** The time chip: this week ("today through six days from today"), optionally within these hours. */
  readonly thisWeek?: { readonly hours?: HourRange };
}

export type DraftErrandOutcome =
  | { readonly kind: "drafted"; readonly errand: Errand; readonly changed: readonly ErrandField[] }
  /** Nothing was chosen on the composer, so the errand is left for the conversation (and memory) to start. */
  | { readonly kind: "empty_draft" }
  /** The session already has an errand; the composer only starts new ones. */
  | { readonly kind: "errand_exists"; readonly errand: Errand }
  | { readonly kind: "unknown_area"; readonly knownAreas: readonly string[] }
  | { readonly kind: "invalid_detail"; readonly field: ErrandField; readonly reason: InvalidDetailReason };

export interface DraftErrandDependencies extends ErrandDependencies {
  /** Says what "this week" is: the world's clock, which evals and browser checks pin. */
  readonly calendar: Clock;
}

function patchOf(draft: ErrandDraft, today: string): ErrandPatch {
  const { area, budget, thisWeek } = draft;
  return {
    ...(area === undefined ? {} : { area }),
    ...(budget === undefined ? {} : { budget }),
    ...(thisWeek === undefined
      ? {}
      : {
          timeWindow: {
            dates: { from: today, to: dayAfter(today, 6) },
            ...(thisWeek.hours === undefined ? {} : { hours: thisWeek.hours }),
          },
        }),
  };
}

function draftedEvent(errand: Errand, changed: readonly ErrandField[], place: TracePlace, atMs: number): TraceEvent {
  return {
    type: "event",
    traceId: place.traceId,
    eventId: `${errand.errandId}:composer-draft`,
    sessionId: place.sessionId,
    kind: "errand_drafted",
    name: `composer → errand: ${changed.join(", ")}`,
    timeMs: atMs,
    attributes: { "errand.id": errand.errandId, "errand.composer.fields": [...changed] },
  };
}

export async function draftErrand(
  deps: DraftErrandDependencies,
  request: { readonly place: TracePlace; readonly draft: ErrandDraft },
): Promise<DraftErrandOutcome> {
  const existing = await deps.errands.find(request.place.sessionId);
  if (existing !== undefined) return { kind: "errand_exists", errand: existing };
  const patch = patchOf(request.draft, istDayOf(deps.calendar.now().getTime()));
  if (Object.keys(patch).length === 0) return { kind: "empty_draft" };
  // Checked before anything is saved: a refused draft must not leave an empty errand behind,
  // or memory would no longer start the session's errand.
  const check = resolveAgainstCatalog(patch, deps.catalog);
  if (check.kind === "unknown_area") return { kind: "unknown_area", knownAreas: check.knownAreas };
  const patched = patchDetails(EMPTY_DETAILS, check.kind === "resolved" ? check.patch : patch);
  if (patched.kind === "invalid_detail") return { kind: "invalid_detail", field: patched.field, reason: patched.reason };

  const outcome = await updateErrand(deps, { place: request.place, patch });
  switch (outcome.kind) {
    case "updated":
      await deps.traceSink.record(draftedEvent(outcome.errand, outcome.changed, request.place, deps.clock.now().getTime()));
      return { kind: "drafted", errand: outcome.errand, changed: outcome.changed };
    case "unknown_area":
      return { kind: "unknown_area", knownAreas: outcome.knownAreas };
    case "invalid_detail":
      return { kind: "invalid_detail", field: outcome.field, reason: outcome.reason };
    // A new errand is gathering and its service isn't drafted, so neither can happen; if one
    // does, the errand that now exists is the answer.
    case "unknown_service":
    case "not_editable":
      return { kind: "errand_exists", errand: outcome.errand };
  }
}
