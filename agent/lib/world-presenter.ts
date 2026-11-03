import type { ProviderDetails as WireProviderDetails } from "@errand/contracts";

import type { ProviderDetails, ProviderSummary } from "../../src/core/ports/provider-world";

// Core types to wire shapes. Kept apart from the tools so a wire change can't reach core.

export function presentSummary(provider: ProviderSummary) {
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
