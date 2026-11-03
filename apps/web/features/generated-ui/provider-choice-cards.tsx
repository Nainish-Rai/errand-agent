"use client";

import { useAuiState } from "@assistant-ui/react";
import { bindChoice, chooseMessage, slotLabel, type BoundChoice } from "@errand/client";
import type { ProviderChoiceProps, Slot } from "@errand/contracts";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, Tag } from "@openuidev/react-ui";
import { ChevronLeft, ChevronRight, Star } from "lucide-react";
import { useState } from "react";

import { Money } from "@/components/money";
import { Skeleton } from "@/components/skeleton";
import { Button } from "@/components/ui/button";

import { useGeneratedUiHost, useProviders } from "./bound-data";
import { ProviderDetailsPanel } from "./provider-details";

// Provider choice cards: a service photo, the model's highlight, name, rating, price, earliest
// slot, the model's one-line reason, and Choose and Details. Up to three show in a row; "See all"
// opens a carousel of every option. Every fact on a card is the world's (bound by provider id).
// Choose only sends "I'll take …" as the person; the agent then holds the slot and shows the fixed
// approval card, so nothing here can book.

export interface ChoiceInput extends ProviderChoiceProps {
  /** The world's earliest slot for this errand, when the card shows a search option. */
  readonly earliest?: Slot;
}

const ROW = 3;

function ChoiceCard({ choice, onDetails, detailsOpen }: { readonly choice: BoundChoice; readonly onDetails: () => void; readonly detailsOpen: boolean }) {
  const { api, send } = useGeneratedUiHost();
  const running = useAuiState((state) => state.thread.isRunning);
  const [chosen, setChosen] = useState(false);
  const slot = choice.earliestSlot === undefined ? undefined : slotLabel(choice.earliestSlot);
  return (
    <article
      aria-label={choice.name}
      data-testid="provider-choice-card"
      data-provider-id={choice.providerId}
      className="flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-edge bg-surface-card"
    >
      <div className="relative aspect-[3/2] bg-surface-well">
        {choice.photo === undefined ? (
          <div className="grid h-full place-items-center text-label text-fg-meta">No photo</div>
        ) : (
          <img src={api.photoUrl(choice.photo.src)} alt={choice.photo.alt} className="size-full object-cover" loading="lazy" />
        )}
        {choice.highlight !== undefined && (
          <div className="absolute top-2 left-2">
            <Tag text={choice.highlight} size="sm" variant="info" />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <h3 className="m-0 text-panel font-medium text-fg-emph">{choice.name}</h3>
        <div className="flex items-center justify-between gap-2 text-label text-fg-meta">
          <span className="inline-flex items-center gap-1 font-mono tabular-nums" aria-label={`Rated ${choice.rating} from ${choice.reviewCount} reviews`}>
            <Star aria-hidden className="size-3" />
            {choice.rating} <span className="text-fg-meta">({choice.reviewCount})</span>
          </span>
          <Money amount={choice.priceInr} className="text-body text-fg-emph" />
        </div>
        <p className="m-0 text-label text-fg-body">{slot === undefined ? "No free slot this week" : `Earliest: ${slot}`}</p>
        {choice.reason !== undefined && <p className="m-0 text-label text-fg-meta">{choice.reason}</p>}
        <div className="mt-auto flex gap-1.5 pt-1.5">
          <Button
            size="sm"
            variant="primary"
            disabled={running || chosen}
            onClick={() => {
              setChosen(true);
              void send(chooseMessage(choice.name, slot));
            }}
          >
            {chosen ? "Chosen" : "Choose"}
          </Button>
          <Button size="sm" variant="secondary" aria-expanded={detailsOpen} onClick={onDetails}>
            Details
          </Button>
        </div>
      </div>
    </article>
  );
}

function CardsSkeleton({ count }: { readonly count: number }) {
  return (
    <div aria-busy className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {Array.from({ length: Math.min(count, ROW) }, (_, index) => (
        <div key={index} className="flex flex-col gap-2 rounded-lg border border-edge bg-surface-card p-3">
          <Skeleton className="aspect-[3/2] h-auto" />
          <Skeleton className="w-2/3" />
          <Skeleton className="w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function ProviderChoiceCards({
  choices,
  more = [],
  title,
  everyoneLabel,
}: {
  readonly choices: readonly ChoiceInput[];
  /** Further options, shown only in the "See all" carousel. */
  readonly more?: readonly ChoiceInput[];
  readonly title?: string;
  /** What "See all" lists, e.g. "plumber in Koramangala": names its region and counts it. */
  readonly everyoneLabel?: string;
}) {
  const everyone = [...choices, ...more];
  const providers = useProviders(everyone.map((choice) => choice.providerId));
  const [showAll, setShowAll] = useState(false);
  const [details, setDetails] = useState<string>();

  if (providers.status === "loading") return <CardsSkeleton count={choices.length} />;
  if (providers.status === "failed") return <p className="my-2 text-label text-fg-meta">Can't load these providers right now.</p>;

  const byId = new Map(providers.data.map((provider) => [provider.id, provider]));
  const bind = (inputs: readonly ChoiceInput[]) =>
    inputs.flatMap((input) => {
      const provider = byId.get(input.providerId);
      return provider === undefined ? [] : [bindChoice(input, provider, input.earliest)];
    });
  const row = bind(choices);
  const all = bind(everyone);
  const toggle = (providerId: string) => setDetails((open) => (open === providerId ? undefined : providerId));
  const card = (choice: BoundChoice) => (
    <ChoiceCard choice={choice} detailsOpen={details === choice.providerId} onDetails={() => toggle(choice.providerId)} />
  );
  const carousel = (choicesShown: readonly BoundChoice[], label: string) => (
    <Carousel variant="sunk" showButtons aria-label={label} className="openui-carousel">
      <CarouselContent role="list">
        {choicesShown.map((choice) => (
          <CarouselItem key={choice.providerId} role="listitem" className="w-60 flex-none">
            {card(choice)}
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious icon={<ChevronLeft />} aria-label="Previous options" />
      <CarouselNext icon={<ChevronRight />} aria-label="Next options" />
    </Carousel>
  );
  const label = title ?? "Provider options";

  return (
    <section aria-label={label} data-testid="provider-choices" className="my-3 flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="m-0 text-label text-fg-meta">{title ?? "Options"}</p>
        {all.length > row.length && (
          <Button size="sm" variant="ghost" aria-expanded={showAll} onClick={() => setShowAll((open) => !open)}>
            {showAll ? "Show fewer" : `See all ${all.length}`}
          </Button>
        )}
      </div>
      {showAll ? null : row.length > ROW ? (
        carousel(row, label)
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-3">
          {row.map((choice) => (
            <li key={choice.providerId} className="min-w-0">
              {card(choice)}
            </li>
          ))}
        </ul>
      )}
      {showAll && (
        <section aria-label={everyoneLabel === undefined ? "All options" : `Search results for ${everyoneLabel}`} className="flex flex-col gap-1.5">
          <p className="m-0 text-label text-fg-meta">{everyoneLabel === undefined ? `All ${all.length}` : `All ${all.length} ${everyoneLabel}`}</p>
          {carousel(all, "All options")}
        </section>
      )}
      {details !== undefined && byId.has(details) && <ProviderDetailsPanel providerId={details} />}
    </section>
  );
}
