"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { SearchProvidersOutputSchema, type ProviderSummary, type Slot } from "@errand/contracts";
import { Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";

const slotFormat = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

function formatSlot(slot: Slot): string {
  return slotFormat.format(new Date(slot.start));
}

function ProviderRow({ provider }: { readonly provider: ProviderSummary }) {
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{provider.name}</span>
        <span className="shrink-0 tabular-nums">₹{provider.priceInr.toLocaleString("en-IN")}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Star aria-hidden className="size-3.5" />
          {provider.rating} ({provider.reviewCount})
        </span>
        <span>
          {provider.freeSlots.length === 0
            ? "No free slots in this range"
            : `Earliest: ${provider.freeSlots.slice(0, 2).map(formatSlot).join(", ")}`}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {provider.attributes.map((attribute) => (
          <Badge key={attribute} variant="secondary">
            {attribute.replaceAll("_", " ")}
          </Badge>
        ))}
      </div>
    </li>
  );
}

/** Renders search_providers from the tool's own output, so every value shown is the world's. */
export const ProviderResults: ToolCallMessagePartComponent = ({ args, result, status }) => {
  const query = args as { service?: string; area?: string };
  const label = `${query.service ?? "providers"} in ${query.area ?? "your area"}`;

  if (result === undefined) {
    return (
      <div className="my-2 flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Searching {label}…
      </div>
    );
  }

  const parsed = SearchProvidersOutputSchema.safeParse(result);
  if (!parsed.success || status.type === "incomplete") {
    return <p className="my-2 text-sm text-muted-foreground">The search for {label} failed.</p>;
  }
  if (parsed.data.kind !== "found") {
    return <p className="my-2 text-sm text-muted-foreground">No search for {label}: {parsed.data.kind.replaceAll("_", " ")}.</p>;
  }

  return (
    <section aria-label={`Search results for ${label}`} className="my-3">
      <p className="mb-2 text-sm text-muted-foreground">
        {parsed.data.providers.length} {label}
      </p>
      <ul className="flex flex-col gap-2">
        {parsed.data.providers.map((provider) => (
          <ProviderRow key={provider.id} provider={provider} />
        ))}
      </ul>
    </section>
  );
};
