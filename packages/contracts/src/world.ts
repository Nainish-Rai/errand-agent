import { z } from "zod";

// Wire shapes of the provider world. Core keeps its own plain types; the agent tools and the
// app API map between the two.

export const ServiceKindSchema = z.enum(["plumber", "electrician", "ac_servicing", "carpenter", "cleaner"]);

export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

export const DateRangeSchema = z.object({
  from: IsoDateSchema.describe("First day, inclusive, YYYY-MM-DD in IST."),
  to: IsoDateSchema.describe("Last day, inclusive, YYYY-MM-DD in IST."),
});

export const SlotSchema = z.object({
  start: z.string().describe("ISO 8601 start with the +05:30 offset."),
  end: z.string().describe("ISO 8601 end with the +05:30 offset."),
});

export const ProviderSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  service: ServiceKindSchema,
  area: z.string(),
  priceInr: z.number(),
  rating: z.number(),
  reviewCount: z.number(),
  freeSlots: z.array(SlotSchema),
  attributes: z.array(z.string()),
});

export const ReviewSchema = z.object({
  author: z.string(),
  rating: z.number(),
  postedOn: z.string(),
  text: z.string(),
});

/** A photo of the provider's work, served by the backend: `src` is a path under the API, e.g. /api/v1/assets/providers/plumber-2.webp */
export const ProviderPhotoSchema = z.object({
  src: z.string(),
  alt: z.string(),
});

export const ProviderDetailsSchema = ProviderSummarySchema.extend({
  about: z.string(),
  cancellationTerms: z.string(),
  reviews: z.array(ReviewSchema),
  /** The cover first, then the gallery. */
  photos: z.array(ProviderPhotoSchema),
});

export const SearchProvidersInputSchema = z.object({
  service: z.string().min(1).describe("The service needed, e.g. plumber, electrician, ac_servicing, carpenter, cleaner."),
  area: z.string().min(1).describe("The Bengaluru neighbourhood, e.g. Koramangala."),
  date_range: DateRangeSchema.describe("The days the visit may happen on, at most 14 days."),
});

export const SearchProvidersOutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("found"), providers: z.array(ProviderSummarySchema) }),
  z.object({ kind: z.literal("unknown_service"), knownServices: z.array(ServiceKindSchema) }),
  z.object({ kind: z.literal("unknown_area"), knownAreas: z.array(z.string()) }),
  z.object({ kind: z.literal("invalid_date_range"), reason: z.string() }),
]);

export type ServiceKind = z.infer<typeof ServiceKindSchema>;
export type Slot = z.infer<typeof SlotSchema>;
export type ProviderSummary = z.infer<typeof ProviderSummarySchema>;
export type ProviderDetails = z.infer<typeof ProviderDetailsSchema>;
export type ProviderPhoto = z.infer<typeof ProviderPhotoSchema>;
export type SearchProvidersInput = z.infer<typeof SearchProvidersInputSchema>;
export type SearchProvidersOutput = z.infer<typeof SearchProvidersOutputSchema>;
