import type { ProviderDetails as WireProviderDetails, SearchProvidersOutput } from "@errand/contracts";

import type { ProviderDetails, ProviderSummary, SearchOutcome } from "../../src/core/ports/provider-world";

// Core types to wire shapes. Kept apart from the tools so a wire change can't reach core.

function presentSummary(provider: ProviderSummary) {
  return {
    id: provider.id,
    name: provider.name,
    service: provider.service,
    area: provider.area,
    priceInr: provider.priceInr,
    rating: provider.rating,
    reviewCount: provider.reviewCount,
    freeSlots: provider.freeSlots.map((slot) => ({ start: slot.start, end: slot.end })),
    attributes: [...provider.attributes],
  };
}

export function presentProviderDetails(provider: ProviderDetails): WireProviderDetails {
  return {
    ...presentSummary(provider),
    about: provider.about,
    cancellationTerms: provider.cancellationTerms,
    reviews: provider.reviews.map((review) => ({ ...review })),
  };
}

export function presentSearchOutcome(outcome: SearchOutcome): SearchProvidersOutput {
  switch (outcome.kind) {
    case "found":
      return { kind: "found", providers: outcome.providers.map(presentSummary) };
    case "unknown_service":
      return { kind: "unknown_service", knownServices: [...outcome.knownServices] };
    case "unknown_area":
      return { kind: "unknown_area", knownAreas: [...outcome.knownAreas] };
    case "invalid_date_range":
      return { kind: "invalid_date_range", reason: outcome.reason };
  }
}
