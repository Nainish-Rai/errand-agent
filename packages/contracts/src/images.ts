import { z } from "zod";

import { ServiceKindSchema } from "./world";

// Photos on the wire are asset keys, never URLs. The provider world names a key for a provider or a
// service; each client ships its own files for these keys (the web app's registry is
// apps/web/features/images/registry.ts) and resolves nothing else. A key the client doesn't ship,
// a URL or a data: URI shows the fallback (initials or a line icon), and the client fetches nothing.
//
// The wire keeps keys as plain strings, not this enum: a provider network is untrusted, so the
// client, not the parse, decides what to draw, and one bad key can't drop a whole provider.

export const IMAGE_KEYS = [
  // The design system's set (design-system-v3.html, Images and Credits).
  "plumbing",
  "ac-servicing",
  "electrician",
  "deep-cleaning",
  "pest-control",
  "carpentry",
  "appliance-repair",
  "ac-gas-refill",
  "ac-deep-clean",
  "ac-repair",
  "plumbing-job",
  "plumber-kit",
  "plumber-tool-bag",
  "plumber-at-work",
  // Work photos of each service, for provider cards and galleries.
  "work-ac-1",
  "work-ac-2",
  "work-ac-3",
  "work-ac-4",
  "work-plumbing-1",
  "work-plumbing-2",
  "work-plumbing-3",
  "work-electrical-1",
  "work-electrical-2",
  "work-electrical-3",
  "work-carpentry-1",
  "work-carpentry-2",
  "work-carpentry-3",
  "work-carpentry-4",
  "work-cleaning-1",
  "work-cleaning-2",
  "work-cleaning-3",
  "work-cleaning-4",
] as const;

export type ImageKey = (typeof IMAGE_KEYS)[number];

/** An asset key from the provider world. Untrusted: clients draw only keys they ship. */
export const ImageKeyRefSchema = z.string().describe("An image asset key, never a URL");

/**
 * Something the person can pick when starting or narrowing an errand: a service (a home tile) or a
 * kind of one service ("Which AC service?"). Every fact on its card is the world's.
 */
export const ServiceOptionViewSchema = z.object({
  id: z.string(),
  service: ServiceKindSchema,
  label: z.string(),
  description: z.string(),
  /** The lowest price the world quotes for it. */
  fromPriceInr: z.number(),
  image: ImageKeyRefSchema,
});

/** GET /api/v1/services. */
export const ListServiceOptionsResponseSchema = z.object({
  /** One per service the world covers, in the home tiles' order. */
  services: z.array(ServiceOptionViewSchema),
  /** Kinds of one service, such as gas refill, deep clean and repair for AC servicing. */
  kinds: z.array(ServiceOptionViewSchema),
});

export type ServiceOptionView = z.infer<typeof ServiceOptionViewSchema>;
export type ListServiceOptionsResponse = z.infer<typeof ListServiceOptionsResponseSchema>;
