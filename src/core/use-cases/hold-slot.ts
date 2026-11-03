import type { Errand } from "../errand/errand";
import type { ErrandState, TracePlace } from "../errand/errand-workflow";
import type { Hold, Slot } from "../ports/provider-world";
import { traceNewTransitions } from "./errand-session";
import { moved, type ProposalDependencies } from "./proposal-session";

// The person chose an option: hold that slot with the provider so it can't be taken while they
// look at the approval card. The hold the world returns (its price, slot and expiry) is what the
// proposal is later made from.

export type HoldSlotOutcome =
  | { readonly kind: "held"; readonly errand: Errand; readonly hold: Hold }
  | { readonly kind: "slot_unavailable"; readonly errand: Errand }
  | { readonly kind: "provider_not_found"; readonly errand: Errand }
  /** The errand replaces a booking this provider cancelled; it can't be offered again. */
  | { readonly kind: "provider_excluded"; readonly errand: Errand; readonly providerName: string }
  /** Only an errand whose options are on screen can hold a slot. */
  | { readonly kind: "not_choosing"; readonly state: ErrandState | null; readonly errand?: Errand };

async function held(
  errand: Errand,
  choice: { readonly providerId: string; readonly slot: Slot },
  deps: ProposalDependencies,
): Promise<HoldSlotOutcome> {
  if (errand.state !== "choosing") return { kind: "not_choosing", state: errand.state, errand };
  if (errand.replacing?.providerId === choice.providerId) {
    return { kind: "provider_excluded", errand, providerName: errand.replacing.providerName };
  }
  const outcome = await deps.world.holdSlot(choice.providerId, choice.slot);
  if (outcome.kind !== "held") return { kind: outcome.kind, errand };
  const holding = moved(errand, "holding", "slot_held", deps.errand.clock);
  return { kind: "held", errand: { ...holding, hold: outcome.hold }, hold: outcome.hold };
}

export function holdSlot(
  deps: ProposalDependencies,
  request: { readonly place: TracePlace; readonly providerId: string; readonly slot: Slot },
): Promise<HoldSlotOutcome> {
  return deps.errand.errands.change(request.place.sessionId, async (current) => {
    if (current === undefined) return { result: { kind: "not_choosing", state: null } };
    const outcome = await held(current, request, deps);
    if (outcome.errand === undefined) return { result: outcome };
    await traceNewTransitions(deps.errand.traceSink, current, outcome.errand, request.place);
    return { errand: outcome.errand, result: outcome };
  });
}
