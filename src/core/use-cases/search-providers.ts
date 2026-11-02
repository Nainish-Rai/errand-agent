import type { ProviderWorld, SearchOutcome, SearchQuery } from "../ports/provider-world";

export function searchProviders(world: ProviderWorld, query: SearchQuery): Promise<SearchOutcome> {
  return world.searchProviders(query);
}
