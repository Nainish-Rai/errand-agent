import type { ImageKey } from "@errand/contracts";

import type { ServiceKind } from "../../core/ports/provider-world";
import { drawFor } from "./seed/seeded-random";

// The mock world's photos, as image asset keys: a provider id or a service id maps to a key, and
// each client ships the files and resolves only keys it knows. The world never hands out a URL.
// Covers are picked from the provider id, so a provider keeps its photos across seeds and restarts,
// and neighbours in a list rarely share a cover.

/** Whether the world names real keys, or (the untrusted_images scenario) hostile values in their place. */
export type ImageMode = "registered" | "untrusted";

const GALLERY_SIZE = 3;

/** Each service's work photos, 4:3. */
const WORK_PHOTOS: Readonly<Record<ServiceKind, readonly ImageKey[]>> = {
  plumber: ["plumbing", "plumbing-job", "work-plumbing-1", "work-plumbing-2", "work-plumbing-3"],
  electrician: ["electrician", "work-electrical-1", "work-electrical-2", "work-electrical-3"],
  ac_servicing: ["ac-servicing", "work-ac-1", "work-ac-2", "work-ac-3", "work-ac-4"],
  carpenter: ["carpentry", "work-carpentry-1", "work-carpentry-2", "work-carpentry-3", "work-carpentry-4"],
  cleaner: ["deep-cleaning", "work-cleaning-1", "work-cleaning-2", "work-cleaning-3", "work-cleaning-4"],
};

/** Plumbing teams with their own square photo (v3's Shiva Sanitary, Ravi Plumbing and AquaFix). */
const TEAM_PHOTOS: Readonly<Record<string, ImageKey>> = {
  Shiva: "plumber-kit",
  Ravi: "plumber-at-work",
  QuickFix: "plumber-tool-bag",
};

/**
 * What a hostile provider network might send where a key belongs: a URL, a data: URI, a path on
 * the app's own origin, a file name, prototype names and a key nobody ships. Clients must draw the
 * fallback for every one and fetch nothing.
 */
export const UNTRUSTED_IMAGE_VALUES: readonly string[] = [
  "https://images.example.com/provider.png",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "/hostile/thumbnail.webp",
  "plumbing-1x1.webp",
  "__proto__",
  "constructor",
  "not-a-registered-key",
];

function untrusted(...parts: readonly string[]): string {
  const index = Math.floor(drawFor(0, "untrusted-image", ...parts) * UNTRUSTED_IMAGE_VALUES.length);
  return UNTRUSTED_IMAGE_VALUES[index] ?? "not-a-registered-key";
}

export interface ProviderImages {
  /** The square thumbnail. */
  readonly image: string;
  /** The cover first, then the gallery. */
  readonly photos: readonly string[];
}

/** A provider's thumbnail and work photos, from its id (and its name's stem, for the named teams). */
export function imagesFor(providerId: string, stem: string, service: ServiceKind, mode: ImageMode): ProviderImages {
  const pool = WORK_PHOTOS[service];
  const start = Math.floor(drawFor(0, "photo", providerId) * pool.length);
  const photos = [...pool.slice(start), ...pool.slice(0, start)].slice(0, GALLERY_SIZE + 1);
  if (mode === "untrusted") {
    return { image: untrusted(providerId, "image"), photos: photos.map((_, index) => untrusted(providerId, String(index))) };
  }
  const team = service === "plumber" ? TEAM_PHOTOS[stem] : undefined;
  return { image: team ?? photos[0] ?? pool[0] ?? "plumbing", photos };
}

/** A service option's image: its registered key, or a hostile value in the untrusted_images scenario. */
export function serviceImageFor(optionId: string, key: ImageKey, mode: ImageMode): string {
  return mode === "untrusted" ? untrusted(optionId) : key;
}
