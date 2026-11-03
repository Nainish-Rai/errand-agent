"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { ErrandSearchOutputSchema, type ErrandOption, type OptionTag, type ProviderSummary, type Slot } from "@errand/contracts";
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

const TAG_LABELS: Readonly<Record<OptionTag, string>> = {
  best_match: "Best match",
  cheapest: "Cheapest",
  earliest: "Earliest",
  runner_up: "Runner-up",
};

function OptionCard({ option, provider }: { readonly option: ErrandOption; readonly provider: ProviderSummary | undefined }) {
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-interactive/50 bg-card px-3 py-2.5">
      <div className="flex flex-wrap gap-1">
        {option.tags.map((tag) => (
          <Badge key={tag} variant="verified">
            {TAG_LABELS[tag]}
          </Badge>
        ))}
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{provider?.name ?? option.providerId}</span>
        {provider !== undefined && <span className="shrink-0 tabular-nums">₹{provider.priceInr.toLocaleString("en-IN")}</span>}
      </div>
      <p className="text-sm text-muted-foreground">{option.reason}</p>
      <p className="text-sm text-muted-foreground">Earliest in your window: {formatSlot(option.earliestSlot)}</p>
    </li>
  );
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

function exclusionsLine(overBudget: number, outsideTimeWindow: number): string | undefined {
  const parts = [
    overBudget > 0 ? `${overBudget} over budget` : undefined,
    outsideTimeWindow > 0 ? `${outsideTimeWindow} with no slot in your time window` : undefined,
  ].filter(Boolean);
  return parts.length === 0 ? undefined : `Left out: ${parts.join(", ")}.`;
}

/**
 * Renders search_providers from the tool's own output, so every value shown is the world's. Core
 * already dropped every provider outside the errand's budget and time window; the tagged options
 * come first, then everything that fits.
 */
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

  const parsed = ErrandSearchOutputSchema.safeParse(result);
  if (!parsed.success || status.type === "incomplete") {
    return <p className="my-2 text-sm text-muted-foreground">The search for {label} failed.</p>;
  }
  const output = parsed.data;
  if (output.kind === "no_options") {
    return (
      <p className="my-2 text-sm text-muted-foreground">
        None of the {output.searched} {label} fit. {exclusionsLine(output.excluded.overBudget, output.excluded.outsideTimeWindow)}
      </p>
    );
  }
  if (output.kind !== "found") {
    return <p className="my-2 text-sm text-muted-foreground">No search for {label}: {output.kind.replaceAll("_", " ")}.</p>;
  }

  const byId = new Map(output.providers.map((provider) => [provider.id, provider]));
  const left = exclusionsLine(output.excluded.overBudget, output.excluded.outsideTimeWindow);
  return (
    <div className="my-3 flex flex-col gap-3">
      <section aria-label={`Options for ${label}`}>
        <p className="mb-2 text-sm text-muted-foreground">Best options for {label}</p>
        <ul className="flex flex-col gap-2">
          {output.options.map((option) => (
            <OptionCard key={option.providerId} option={option} provider={byId.get(option.providerId)} />
          ))}
        </ul>
      </section>
      <section aria-label={`Search results for ${label}`}>
        <p className="mb-2 text-sm text-muted-foreground">
          {output.providers.length} {label}
          {left === undefined ? "" : ` · ${left}`}
        </p>
        <ul className="flex flex-col gap-2">
          {output.providers.map((provider) => (
            <ProviderRow key={provider.id} provider={provider} />
          ))}
        </ul>
      </section>
    </div>
  );
};
