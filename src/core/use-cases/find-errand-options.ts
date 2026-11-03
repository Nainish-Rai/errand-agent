import { isComplete, missingFields, patchDetails, type Errand, type RequiredField } from "../errand/errand";
import { selectOptions, type Exclusions, type OptionSelection } from "../errand/errand-options";
import { isEditable, transitionTo, type ErrandState, type TracePlace, type TransitionReason } from "../errand/errand-workflow";
import type { DateRange, ProviderWorld } from "../ports/provider-world";
import { errandOrNew, traceNewTransitions, type ErrandDependencies } from "./errand-session";
import { resolveAgainstCatalog, type UpdateErrandOutcome } from "./update-errand";

// Searches the world for the errand and turns the results into two or three tagged options.
// The search's service, area and dates are written to the errand first, so the errand always
// says what was searched. The hours of the day and the budget come from the errand, and the
// filtering happens here, in code.

export interface ErrandSearch {
  readonly service: string;
  readonly area: string;
  readonly dates: DateRange;
}

export type FindErrandOptionsOutcome =
  | { readonly kind: "options"; readonly errand: Errand; readonly selection: OptionSelection }
  /** The world has providers, but none within the budget and time window. */
  | { readonly kind: "no_options"; readonly errand: Errand; readonly excluded: Exclusions; readonly searched: number }
  | { readonly kind: "invalid_date_range"; readonly errand: Errand; readonly reason: string }
  | { readonly kind: "missing_details"; readonly errand: Errand; readonly missing: readonly RequiredField[] }
  | Exclude<UpdateErrandOutcome, { readonly kind: "updated" }>;

interface Mover {
  errand: Errand;
  readonly deps: ErrandDependencies;
}

/** Moves the errand along the workflow. A refusal here is a bug in this use case, not an outcome. */
function move(mover: Mover, to: ErrandState, reason: TransitionReason): void {
  const moved = transitionTo(mover.errand, to, reason, mover.deps.clock.now().getTime());
  if (moved.kind === "illegal_transition") throw new Error(`The workflow refused ${moved.from} → ${moved.to}.`);
  mover.errand = moved.subject;
}

async function searched(
  start: Errand,
  search: ErrandSearch,
  deps: ErrandDependencies & { readonly world: ProviderWorld },
): Promise<FindErrandOptionsOutcome> {
  if (!isEditable(start.state)) return { kind: "not_editable", errand: start };
  const hours = start.details.timeWindow?.hours;
  const check = resolveAgainstCatalog(
    { service: search.service, area: search.area, timeWindow: { dates: search.dates, ...(hours === undefined ? {} : { hours }) } },
    deps.catalog,
  );
  if (check.kind !== "resolved") return { ...check, errand: start };
  const patched = patchDetails(start.details, check.patch);
  if (patched.kind === "invalid_detail") return { ...patched, errand: start };
  const mover: Mover = { errand: { ...start, details: patched.details }, deps };
  const { details } = mover.errand;
  const { service, area, timeWindow } = details;
  if (!isComplete(details) || service === undefined || area === undefined || timeWindow === undefined) {
    return { kind: "missing_details", errand: mover.errand, missing: missingFields(details) };
  }

  move(mover, "searching", "search_started");
  const found = await deps.world.searchProviders({ service, area, dateRange: timeWindow.dates });
  if (found.kind !== "found") {
    move(mover, "gathering", "search_rejected");
    if (found.kind === "invalid_date_range") return { kind: "invalid_date_range", errand: mover.errand, reason: found.reason };
    return { ...found, errand: mover.errand };
  }

  // A replacement never offers the provider who cancelled the booking it replaces.
  const providers = found.providers.filter((provider) => provider.id !== start.replacing?.providerId);
  const selection = selectOptions(providers, { ...details, timeWindow });
  if (selection.options.length === 0) {
    move(mover, "gathering", "no_options");
    return { kind: "no_options", errand: mover.errand, excluded: selection.excluded, searched: found.providers.length };
  }
  move(mover, "choosing", "options_found");
  return { kind: "options", errand: mover.errand, selection };
}

export function findErrandOptions(
  deps: ErrandDependencies & { readonly world: ProviderWorld },
  request: { readonly place: TracePlace; readonly search: ErrandSearch },
): Promise<FindErrandOptionsOutcome> {
  return deps.errands.change(request.place.sessionId, async (current) => {
    const outcome = await searched(errandOrNew(current, request.place, deps.clock), request.search, deps);
    await traceNewTransitions(deps.traceSink, current, outcome.errand, request.place);
    return { errand: outcome.errand, result: outcome };
  });
}
