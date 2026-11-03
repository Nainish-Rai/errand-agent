"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { ErrandSearchOutputSchema, type ErrandOption, type OptionTag, type ProviderSummary, type Slot } from "@errand/contracts";

import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { ProviderChoiceCards, type ChoiceInput } from "@/features/generated-ui";

// search_providers as provider choice cards: the two or three tagged options as photo cards, and
// "See all N" for everything else that fits the errand, in a carousel. Core already dropped every
// provider outside the budget and time window; each card's facts are read from the world by id.

const TAG_LABELS: Readonly<Record<OptionTag, string>> = {
  best_match: "Best match",
  cheapest: "Cheapest",
  earliest: "Earliest",
  runner_up: "Runner-up",
};

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

export function OptionCard({ option, provider }: { readonly option: ErrandOption; readonly provider: Pick<ProviderSummary, "name" | "priceInr"> | undefined }) {
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

function exclusionsLine(overBudget: number, outsideTimeWindow: number): string | undefined {
  const parts = [
    overBudget > 0 ? `${overBudget} over budget` : undefined,
    outsideTimeWindow > 0 ? `${outsideTimeWindow} with no slot in your time window` : undefined,
  ].filter(Boolean);
  return parts.length === 0 ? undefined : `Left out: ${parts.join(", ")}.`;
}

export const ProviderResults: ToolCallMessagePartComponent = ({ args, result, status, isError }) => {
  const query = args as { service?: string; area?: string };
  const label = `${(query.service ?? "providers").replaceAll("_", " ")} in ${query.area ?? "your area"}`;

  // A call that threw has no result; without this it would look like a search still running.
  if (isError === true) return <p className="my-2 text-label text-fg-meta">The search for {label} failed.</p>;
  if (result === undefined) {
    return (
      <div className="my-2 flex items-center gap-2 text-label text-fg-meta">
        <Spinner /> Searching {label}…
      </div>
    );
  }

  const parsed = ErrandSearchOutputSchema.safeParse(result);
  if (!parsed.success || status.type === "incomplete") return <p className="my-2 text-label text-fg-meta">The search for {label} failed.</p>;
  const output = parsed.data;
  if (output.kind === "no_options") {
    return (
      <p className="my-2 text-label text-fg-meta">
        None of the {output.searched} {label} fit. {exclusionsLine(output.excluded.overBudget, output.excluded.outsideTimeWindow)}
      </p>
    );
  }
  if (output.kind !== "found") return <p className="my-2 text-label text-fg-meta">No search for {label}: {output.kind.replaceAll("_", " ")}.</p>;

  const optionIds = new Set(output.options.map((option) => option.providerId));
  const choices: ChoiceInput[] = output.options.map((option) => ({
    providerId: option.providerId,
    highlight: option.tags.map((tag) => TAG_LABELS[tag]).join(" · "),
    reason: option.reason,
    earliest: option.earliestSlot,
  }));
  const more: ChoiceInput[] = output.providers
    .filter((provider) => !optionIds.has(provider.id))
    .map((provider) => ({
      providerId: provider.id,
      highlight: "",
      reason: "",
      ...(provider.freeSlots[0] === undefined ? {} : { earliest: provider.freeSlots[0] }),
    }));
  const left = exclusionsLine(output.excluded.overBudget, output.excluded.outsideTimeWindow);
  return (
    <div className="flex flex-col">
      <ProviderChoiceCards title={`Options for ${label}`} everyoneLabel={label} choices={choices} more={more} />
      {left !== undefined && <p className="-mt-1 mb-2 text-label text-fg-meta">{left}</p>}
    </div>
  );
};
