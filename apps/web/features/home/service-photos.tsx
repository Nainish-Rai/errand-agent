"use client";

import type { ServiceKind, ServiceOptionView } from "@errand/contracts";
import { useEffect, useState, type ReactNode } from "react";

import { appApi } from "@/features/chat/backend";
import { Photo, ServiceIcon } from "@/features/images";

// The photos for home's "Book a service" tiles and suggestion pills (ticket 22), for the media slots
// of ServiceTiles and FollowUps. The services and their image keys are the world's
// (GET /api/v1/services); the photos are the app's registry. While the services load the slot holds a
// still placeholder of the same size, so nothing moves when they land; a key the app doesn't ship
// shows the service's line icon on --surface, and the browser fetches nothing for it. If the services
// can't be read, the tiles go without media and show their text.

export function useServiceTiles(): readonly ServiceOptionView[] | undefined {
  const [services, setServices] = useState<readonly ServiceOptionView[]>();
  useEffect(() => {
    let live = true;
    appApi.listServiceOptions().then(
      (options) => live && setServices(options.services),
      () => live && setServices([]),
    );
    return () => {
      live = false;
    };
  }, []);
  return services;
}

/** The service a suggestion asks for, by its words: "AC servicing on Saturday morning" is AC servicing. */
const REQUEST_SERVICES: readonly (readonly [RegExp, ServiceKind])[] = [
  [/\bplumb/i, "plumber"],
  [/\bAC\b|air ?con/i, "ac_servicing"],
  [/\belectric/i, "electrician"],
  [/\bclean/i, "cleaner"],
  [/\bcarpent/i, "carpenter"],
];

export function serviceOfRequest(text: string): ServiceKind | undefined {
  return REQUEST_SERVICES.find(([words]) => words.test(text))?.[1];
}

type PhotoSize = { readonly ratio: "landscape" | "square"; readonly className: string; readonly iconClassName?: string; readonly decorative?: boolean };

const TILE: PhotoSize = { ratio: "landscape", className: "size-full" };
const PILL: PhotoSize = { ratio: "square", className: "-my-0.5 -ml-1.5 w-6 rounded-full", iconClassName: "size-3.5", decorative: true };

function mediaOf(services: readonly ServiceOptionView[] | undefined, service: ServiceKind | undefined, size: PhotoSize): ReactNode | undefined {
  if (service === undefined) return undefined;
  if (services === undefined) return <span aria-hidden data-image-state="loading" className={`block flex-none bg-surface-2 ${size.ratio === "square" ? "aspect-square" : "aspect-[4/3]"} ${size.className}`} />;
  const option = services.find((candidate) => candidate.service === service);
  if (option === undefined) return undefined;
  return <Photo imageKey={option.image} ratio={size.ratio} fallback={<ServiceIcon service={service} className={size.iconClassName} />} className={size.className} decorative={size.decorative ?? false} />;
}

/** `mediaFor` for ServiceTiles (a 4:3 photo) and FollowUps (a 24px round photo before the text). */
export function useServicePhotos(): { readonly tile: (service: ServiceKind) => ReactNode; readonly suggestion: (text: string) => ReactNode } {
  const services = useServiceTiles();
  return {
    tile: (service) => mediaOf(services, service, TILE),
    suggestion: (text) => mediaOf(services, serviceOfRequest(text), PILL),
  };
}
