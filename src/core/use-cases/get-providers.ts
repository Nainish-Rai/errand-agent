import type { ProviderDetails, ProviderWorld } from "../ports/provider-world";

/** Fills cards with the world's own values, so a client never shows a model-made price. */
export async function getProviders(
  world: ProviderWorld,
  providerIds: readonly string[],
): Promise<readonly ProviderDetails[]> {
  const outcomes = await Promise.all(providerIds.map((id) => world.getProvider(id)));
  return outcomes.flatMap((outcome) => (outcome.kind === "found" ? [outcome.provider] : []));
}
