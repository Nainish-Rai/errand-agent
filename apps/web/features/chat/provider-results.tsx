"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { ErrandSearchOutputSchema, type ErrandOption, type OptionTag } from "@errand/contracts";

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

/** A search option as a choice card: core's tags as the highlight, its reason, its earliest slot. */
export function choiceFromOption(option: ErrandOption): ChoiceInput {
  return {
    providerId: option.providerId,
    highlight: option.tags.map((tag) => TAG_LABELS[tag]).join(" · "),
    reason: option.reason,
    earliest: option.earliestSlot,
  };
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
  if (isError === true) return <p className="my-2 text-xs text-fg-3">The search for {label} failed.</p>;
  if (result === undefined) {
    return (
      <div className="my-2 flex items-center gap-2 text-xs text-fg-3">
        <Spinner /> Searching {label}…
      </div>
    );
  }

  const parsed = ErrandSearchOutputSchema.safeParse(result);
  if (!parsed.success || status.type === "incomplete") return <p className="my-2 text-xs text-fg-3">The search for {label} failed.</p>;
  const output = parsed.data;
  if (output.kind === "no_options") {
    return (
      <p className="my-2 text-xs text-fg-3">
        None of the {output.searched} {label} fit. {exclusionsLine(output.excluded.overBudget, output.excluded.outsideTimeWindow)}
      </p>
    );
  }
  if (output.kind !== "found") return <p className="my-2 text-xs text-fg-3">No search for {label}: {output.kind.replaceAll("_", " ")}.</p>;

  const optionIds = new Set(output.options.map((option) => option.providerId));
  const choices = output.options.map(choiceFromOption);
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
      {left !== undefined && <p className="-mt-1 mb-2 text-xs text-fg-3">{left}</p>}
    </div>
  );
};
