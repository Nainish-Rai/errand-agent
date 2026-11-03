import type { ListServiceOptionsResponse, ProviderDetails as WireProviderDetails, ServiceOptionView } from "@errand/contracts";

import type { ProviderDetails, ProviderSummary, ServiceOption, ServiceOptions } from "../../src/core/ports/provider-world";

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
    // Asset keys as the world named them, never turned into URLs: clients draw only keys they ship.
    image: provider.image,
    photos: [...provider.photos],
  };
}

function presentServiceOption(option: ServiceOption): ServiceOptionView {
  return { ...option };
}

export function presentServiceOptions(options: ServiceOptions): ListServiceOptionsResponse {
  return { services: options.services.map(presentServiceOption), kinds: options.kinds.map(presentServiceOption) };
}
