import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ProviderPhoto, ServiceKind } from "../../core/ports/provider-world";
import type { ProviderPhotoFiles } from "../../core/ports/provider-photo-files";
import photos from "./assets/photos.json";
import { drawFor } from "./seed/seeded-random";

// Every mock provider's photos: a cover and a small gallery from its service's committed stock
// photos (assets/, fetched once by scripts/fetch-stock-images.ts, credited in assets/CREDITS.md).
// Nothing is fetched at runtime. The cover is picked from the provider id, so a provider keeps
// its photos across seeds and restarts, and neighbours in a list rarely share a cover.

const ASSETS = path.join(import.meta.dirname, "assets");
const GALLERY_SIZE = 3;
const FILE_NAME = /^[a-z_]+-\d+\.webp$/;

const POOLS = new Map<string, ProviderPhoto[]>();
for (const photo of photos) {
  const service = photo.file.replace(/-\d+\.webp$/, "");
  POOLS.set(service, [...(POOLS.get(service) ?? []), { file: photo.file, alt: photo.alt }]);
}

/** The cover first, then the gallery: the pool rotated to start at the provider's own photo. */
export function photosFor(providerId: string, service: ServiceKind): ProviderPhoto[] {
  const pool = POOLS.get(service) ?? [];
  if (pool.length === 0) return [];
  const start = Math.floor(drawFor(0, "photo", providerId) * pool.length);
  return [...pool.slice(start), ...pool.slice(0, start)].slice(0, GALLERY_SIZE + 1);
}

/** Reads a committed photo by its file name; anything that isn't one of them is not found. */
export const providerPhotoFiles: ProviderPhotoFiles = {
  async read(file) {
    if (!FILE_NAME.test(file) || !photos.some((photo) => photo.file === file)) return undefined;
    return new Uint8Array(await readFile(path.join(ASSETS, file)));
  },
};
