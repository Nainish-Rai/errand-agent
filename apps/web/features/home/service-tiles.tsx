"use client";

import type { ErrandAtWorkView } from "@errand/contracts";
import type { ReactNode } from "react";

import { focusRing } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// v3's "Book a service" tiles and home suggestions (FollowUps). A pressed tile or suggestion scales to
// --scale-press and sends its request as written. A tile takes an optional media slot, a 4:3 photo on
// --radius-field (ticket 22 supplies them by `service`); without one it is a quiet text tile on --surface,
// never an icon tile.

export type Service = NonNullable<ErrandAtWorkView["service"]>;

export interface ServiceTileSpec {
  readonly service: Service;
  readonly label: string;
  /** What a press sends, in the person's words. */
  readonly request: string;
}

export const SERVICE_TILES: readonly ServiceTileSpec[] = [
  { service: "plumber", label: "Plumbing", request: "Book a plumber this week" },
  { service: "ac_servicing", label: "AC servicing", request: "Service my AC this week" },
  { service: "electrician", label: "Electrician", request: "Book an electrician this week" },
  { service: "cleaner", label: "Deep cleaning", request: "Book a deep clean this week" },
  { service: "carpenter", label: "Carpentry", request: "Book a carpenter this week" },
];

const press = "transition-[background-color,scale] duration-(--dur-instant) ease-out active:scale-(--scale-press) disabled:cursor-not-allowed";

type ServiceTileProps = {
  readonly tile: ServiceTileSpec;
  /** A 4:3 photo for the service; leave out for the text tile. */
  readonly media?: ReactNode;
  readonly disabled?: boolean;
  readonly onPick: (request: string) => void;
};

export function ServiceTile({ tile, media, disabled = false, onPick }: ServiceTileProps) {
  return (
    <button
      type="button"
      data-service={tile.service}
      disabled={disabled}
      aria-label={`${tile.label}: ${tile.request}`}
      onClick={() => onPick(tile.request)}
      className={cn(
        focusRing,
        press,
        "group flex w-32 flex-none snap-start flex-col gap-2 rounded-field text-left text-sm font-medium text-fg",
        media === undefined && "min-h-20 justify-between bg-surface p-3 hover:bg-surface-2",
      )}
    >
      {media !== undefined && (
        <span className="block aspect-4/3 w-full overflow-hidden rounded-field bg-surface transition-shadow duration-(--dur-instant) ease-out group-hover:shadow-card">
          {media}
        </span>
      )}
      <span>{tile.label}</span>
      {media === undefined && <span className="text-xs font-normal text-fg-3">This week</span>}
    </button>
  );
}

export function ServiceTiles({ disabled, onPick, mediaFor }: { readonly disabled: boolean; readonly onPick: (request: string) => void; readonly mediaFor?: (service: Service) => ReactNode }) {
  return (
    <section aria-label="Book a service" className="grid gap-3">
      <h2 className="m-0 text-lg leading-tight font-semibold text-fg">Book a service</h2>
      <div role="group" aria-label="Services" className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain px-4 pb-1 scroll-px-4">
        {SERVICE_TILES.map((tile) => (
          <ServiceTile key={tile.service} tile={tile} media={mediaFor?.(tile.service)} disabled={disabled} onPick={onPick} />
        ))}
      </div>
    </section>
  );
}

/** v3's FollowUps: requests the person could have typed. A press sends one as written. */
export function FollowUps({ suggestions, disabled, onPick }: { readonly suggestions: readonly string[]; readonly disabled: boolean; readonly onPick: (request: string) => void }) {
  return (
    <div role="group" aria-label="Suggestions" className="flex flex-wrap gap-2">
      {suggestions.map((text) => (
        <button
          key={text}
          type="button"
          disabled={disabled}
          onClick={() => onPick(text)}
          className={cn(focusRing, press, "inline-flex min-h-8 max-w-full items-center rounded-panel border border-line-strong bg-page px-3 py-1 text-left text-sm text-fg hover:bg-surface")}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
