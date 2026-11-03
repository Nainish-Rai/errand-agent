import { patchDetails, type Errand, type ErrandField, type ErrandPatch, type InvalidDetailReason } from "../errand/errand";
import { isEditable, transitionTo, type TracePlace } from "../errand/errand-workflow";
import type { ServiceKind } from "../ports/provider-world";
import type { ServiceCatalog } from "../ports/service-catalog";
import { errandOrNew, traceNewTransitions, type ErrandDependencies } from "./errand-session";

// Fills in or corrects the errand's details. Only the fields the patch names change. A change
// while options are on screen makes them stale, so the errand goes back to gathering and the next
// search starts from the corrected details.

/** A patch as it arrives from outside: the service and area still in the person's own words. */
export type ErrandPatchRequest = Omit<ErrandPatch, "service"> & { readonly service?: string };

export type UpdateErrandOutcome =
  | { readonly kind: "updated"; readonly errand: Errand; readonly changed: readonly ErrandField[] }
  | { readonly kind: "invalid_detail"; readonly errand: Errand; readonly field: ErrandField; readonly reason: InvalidDetailReason }
  | { readonly kind: "unknown_service"; readonly errand: Errand; readonly knownServices: readonly ServiceKind[] }
  | { readonly kind: "unknown_area"; readonly errand: Errand; readonly knownAreas: readonly string[] }
  /** Past choosing (holding a slot, booking), the details are fixed. */
  | { readonly kind: "not_editable"; readonly errand: Errand };

export type CatalogCheck =
  | { readonly kind: "resolved"; readonly patch: ErrandPatch }
  | { readonly kind: "unknown_service"; readonly knownServices: readonly ServiceKind[] }
  | { readonly kind: "unknown_area"; readonly knownAreas: readonly string[] };

/** Puts the service and area in the catalog's own terms, or says which one it doesn't cover. */
export function resolveAgainstCatalog(request: ErrandPatchRequest, catalog: ServiceCatalog): CatalogCheck {
  const { service: serviceText, area: areaText, ...rest } = request;
  const service = serviceText === undefined ? undefined : catalog.resolveService(serviceText);
  if (serviceText !== undefined && service === undefined) {
    return { kind: "unknown_service", knownServices: catalog.services() };
  }
  const area = areaText === undefined ? undefined : catalog.resolveArea(areaText);
  if (areaText !== undefined && area === undefined) return { kind: "unknown_area", knownAreas: catalog.areas() };
  return {
    kind: "resolved",
    patch: { ...rest, ...(service === undefined ? {} : { service }), ...(area === undefined ? {} : { area }) },
  };
}

function applied(errand: Errand, request: ErrandPatchRequest, deps: ErrandDependencies): UpdateErrandOutcome {
  if (!isEditable(errand.state)) return { kind: "not_editable", errand };
  const check = resolveAgainstCatalog(request, deps.catalog);
  if (check.kind !== "resolved") return { ...check, errand };
  const patched = patchDetails(errand.details, check.patch);
  if (patched.kind === "invalid_detail") return { ...patched, errand };
  const next: Errand = { ...errand, details: patched.details };
  if (patched.changed.length === 0 || next.state !== "choosing") {
    return { kind: "updated", errand: next, changed: patched.changed };
  }
  const reopened = transitionTo(next, "gathering", "details_changed", deps.clock.now().getTime());
  if (reopened.kind === "illegal_transition") throw new Error(`The workflow refused ${reopened.from} → ${reopened.to}.`);
  return { kind: "updated", errand: reopened.subject, changed: patched.changed };
}

export function updateErrand(
  deps: ErrandDependencies,
  request: { readonly place: TracePlace; readonly patch: ErrandPatchRequest },
): Promise<UpdateErrandOutcome> {
  return deps.errands.change(request.place.sessionId, async (current) => {
    const outcome = applied(errandOrNew(current, request.place, deps.clock), request.patch, deps);
    await traceNewTransitions(deps.traceSink, current, outcome.errand, request.place);
    return { errand: outcome.errand, result: outcome };
  });
}
