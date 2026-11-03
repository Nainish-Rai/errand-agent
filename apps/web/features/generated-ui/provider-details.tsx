"use client";

import { Money } from "@/components/money";
import { Skeleton } from "@/components/skeleton";
import { Badge } from "@/components/ui/badge";
import { initialsOf, Photo, ProviderThumbnail } from "@/features/images";

import { useProviders } from "./bound-data";

// Provider details: its thumbnail and photos of past work (image keys the registry resolves), what
// the provider says about itself, its tags and its cancellation terms, all from GET /providers/:id. Review insights join it once ticket 09's review
// reader serves them (ReviewInsight is pending until then).

export function ProviderDetailsPanel({ providerId }: { readonly providerId: string }) {
  const providers = useProviders([providerId]);
  if (providers.status === "loading") {
    return (
      <div aria-busy className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-3">
        <Skeleton className="h-24" />
        <Skeleton className="w-1/2" />
      </div>
    );
  }
  const provider = providers.status === "ready" ? providers.data[0] : undefined;
  if (provider === undefined) return <p className="my-2 text-xs text-fg-3">Details aren't available for this provider.</p>;

  return (
    <section aria-label={`${provider.name} details`} data-testid="provider-details" className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ProviderThumbnail imageKey={provider.image} name={provider.name} />
          <h3 className="m-0 text-sm font-medium text-fg">{provider.name}</h3>
        </div>
        <Money amount={provider.priceInr} className="text-sm text-fg" />
      </div>
      <ul aria-label="Photos of past work" className="m-0 grid list-none grid-cols-4 gap-1.5 p-0">
        {provider.photos.map((key, index) => (
          <li key={`${index}-${key}`}>
            <Photo imageKey={key} ratio="landscape" fallback={initialsOf(provider.name)} className="w-full rounded-sm" />
          </li>
        ))}
      </ul>
      <p className="m-0 text-xs text-fg-2">{provider.about}</p>
      <div className="flex flex-wrap gap-1">
        {provider.attributes.map((attribute) => (
          <Badge key={attribute} variant="tag">
            {attribute.replaceAll("_", " ")}
          </Badge>
        ))}
      </div>
      <p className="m-0 text-xs text-fg-3">Cancellation: {provider.cancellationTerms}</p>
    </section>
  );
}
