"use client";

import { ImageGallery } from "@openuidev/react-ui";

import { Money } from "@/components/money";
import { Skeleton } from "@/components/skeleton";
import { Badge } from "@/components/ui/badge";

import { useGeneratedUiHost, useProviders } from "./bound-data";

// Provider details: a gallery of past work, what the provider says about itself, its tags and its
// cancellation terms, all from GET /providers/:id. Review insights join it once ticket 09's review
// reader serves them (ReviewInsight is pending until then).

export function ProviderDetailsPanel({ providerId }: { readonly providerId: string }) {
  const { api } = useGeneratedUiHost();
  const providers = useProviders([providerId]);
  if (providers.status === "loading") {
    return (
      <div aria-busy className="flex flex-col gap-2 rounded-lg border border-edge bg-surface-card p-3">
        <Skeleton className="h-24" />
        <Skeleton className="w-1/2" />
      </div>
    );
  }
  const provider = providers.status === "ready" ? providers.data[0] : undefined;
  if (provider === undefined) return <p className="my-2 text-label text-fg-meta">Details aren't available for this provider.</p>;

  return (
    <section aria-label={`${provider.name} details`} data-testid="provider-details" className="flex flex-col gap-2 rounded-lg border border-edge bg-surface-card p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="m-0 text-panel font-medium text-fg-emph">{provider.name}</h3>
        <Money amount={provider.priceInr} className="text-body text-fg-emph" />
      </div>
      <ImageGallery images={provider.photos.map((photo) => ({ src: api.photoUrl(photo.src), alt: photo.alt }))} />
      <p className="m-0 text-label text-fg-body">{provider.about}</p>
      <div className="flex flex-wrap gap-1">
        {provider.attributes.map((attribute) => (
          <Badge key={attribute} variant="tag">
            {attribute.replaceAll("_", " ")}
          </Badge>
        ))}
      </div>
      <p className="m-0 text-label text-fg-meta">Cancellation: {provider.cancellationTerms}</p>
    </section>
  );
}
