import { ErrandSearchOutputSchema } from "@errand/contracts";

// A reply shows each provider once. search_providers already draws its options as choice cards
// (and every other fit under "See all"), so provider cards the model draws in the same reply for
// only those providers would list them twice. The chat leaves such a repeat out.

/** Every provider a search in this reply already shows as a card. */
export function providersShownBySearch(searchOutputs: readonly unknown[]): ReadonlySet<string> {
  const shown = new Set<string>();
  for (const output of searchOutputs) {
    const parsed = ErrandSearchOutputSchema.safeParse(output);
    if (!parsed.success || parsed.data.kind !== "found") continue;
    for (const option of parsed.data.options) shown.add(option.providerId);
    for (const provider of parsed.data.providers) shown.add(provider.id);
  }
  return shown;
}

/** True when every card names a provider the reply's search already shows. */
export function repeatsSearchCards(providerIds: readonly string[], shownBySearch: ReadonlySet<string>): boolean {
  return providerIds.length > 0 && providerIds.every((id) => shownBySearch.has(id));
}
