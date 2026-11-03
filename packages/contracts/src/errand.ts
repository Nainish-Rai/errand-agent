import { z } from "zod";

import { IsoDateSchema, ProviderSummarySchema, ServiceKindSchema, SlotSchema } from "./world";

// The errand on the wire: the update_errand and get_errand tools, the errand-aware
// search_providers output, and GET /api/v1/sessions/:sessionId/errand. Core keeps its own plain
// types; the agent's presenter maps between the two.

export const ErrandStateSchema = z.enum([
  "gathering",
  "searching",
  "choosing",
  "holding",
  "awaiting_approval",
  "executing",
  "verifying",
  "done",
  "failed",
  "cancelled",
]);

export const ErrandFieldSchema = z.enum(["service", "area", "timeWindow", "budget", "preferences"]);
export const RequiredFieldSchema = z.enum(["service", "area", "timeWindow"]);

const HourSchema = z.number().int().min(0).max(24);

// Tool input. Models often send null for a field they mean to leave alone, so null reads as
// "not given", never as "clear this field".
export const UpdateErrandInputSchema = z.object({
  service: z.string().min(1).nullish().describe("The service, e.g. plumber, electrician, ac_servicing, carpenter, cleaner."),
  area: z.string().min(1).nullish().describe("The Bengaluru neighbourhood, e.g. Koramangala."),
  time_window: z
    .object({
      from: IsoDateSchema.describe("First day, inclusive, YYYY-MM-DD in IST."),
      to: IsoDateSchema.describe("Last day, inclusive, YYYY-MM-DD in IST."),
      earliest_hour: HourSchema.nullish().describe("Earliest start hour in IST, e.g. 8 for mornings. Omit for any time."),
      latest_hour: HourSchema.nullish().describe("Hour the visit must end by in IST, e.g. 12 for mornings. Omit for any time."),
    })
    .nullish()
    .describe("When the visit may happen. Send the whole window when any part of it changes."),
  budget_inr: z.number().positive().nullish().describe("The most the person will pay for the visit, in ₹."),
  preferences: z
    .array(z.string().min(1))
    .nullish()
    .describe("Wishes such as 'female technician' or 'parts included'. Replaces the earlier list."),
});

export const GetErrandInputSchema = z.object({});

export const TimeWindowViewSchema = z.object({
  from: z.string(),
  to: z.string(),
  earliestHour: z.number().nullable(),
  latestHour: z.number().nullable(),
});

/** One tap answer under a clarifying question; tapping it sends `text` as the person's message. */
export const QuickReplySchema = z.object({
  field: RequiredFieldSchema,
  text: z.string(),
});

export const ErrandQuestionSchema = z.object({
  /** One or two required fields, the only ones the agent may ask about in this message. */
  fields: z.array(RequiredFieldSchema).min(1).max(2),
  quickReplies: z.array(QuickReplySchema),
});

export const ErrandTransitionViewSchema = z.object({
  sequence: z.number(),
  from: ErrandStateSchema.nullable(),
  to: ErrandStateSchema,
  reason: z.string(),
  atMs: z.number(),
});

export const ErrandViewSchema = z.object({
  errandId: z.string(),
  state: ErrandStateSchema,
  service: ServiceKindSchema.nullable(),
  area: z.string().nullable(),
  timeWindow: TimeWindowViewSchema.nullable(),
  budgetInr: z.number().nullable(),
  preferences: z.array(z.string()),
  /** Required fields still empty. */
  missing: z.array(RequiredFieldSchema),
  /** What to ask next, or null when nothing is missing. */
  question: ErrandQuestionSchema.nullable(),
  transitions: z.array(ErrandTransitionViewSchema),
  /** The booking this errand replaces after its provider cancelled it (ticket 14); that provider is never offered. */
  replacing: z.object({ bookingId: z.string(), providerId: z.string(), providerName: z.string() }).nullable().optional(),
});

export const UpdateErrandOutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("updated"), errand: ErrandViewSchema, changed: z.array(ErrandFieldSchema) }),
  z.object({ kind: z.literal("invalid_detail"), errand: ErrandViewSchema, field: ErrandFieldSchema, reason: z.string() }),
  z.object({ kind: z.literal("unknown_service"), errand: ErrandViewSchema, knownServices: z.array(ServiceKindSchema) }),
  z.object({ kind: z.literal("unknown_area"), errand: ErrandViewSchema, knownAreas: z.array(z.string()) }),
  z.object({ kind: z.literal("not_editable"), errand: ErrandViewSchema }),
]);

export const GetErrandOutputSchema = z.object({ errand: ErrandViewSchema.nullable() });

export const OptionTagSchema = z.enum(["best_match", "cheapest", "earliest", "runner_up"]);

export const ErrandOptionSchema = z.object({
  providerId: z.string(),
  tags: z.array(OptionTagSchema).min(1),
  /** One line on why it is shown, from the tags and the world's values. */
  reason: z.string(),
  /** The earliest free slot inside the time window. */
  earliestSlot: SlotSchema,
});

export const ExclusionsSchema = z.object({
  overBudget: z.number(),
  outsideTimeWindow: z.number(),
});

/**
 * search_providers as the agent sees it. `found` keeps the assignment's shape (every provider that
 * fits, with its free slots inside the time window) and adds the tagged options and what was left out.
 */
export const ErrandSearchOutputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("found"),
    providers: z.array(ProviderSummarySchema),
    options: z.array(ErrandOptionSchema).min(1).max(3),
    excluded: ExclusionsSchema,
    errand: ErrandViewSchema,
  }),
  z.object({ kind: z.literal("no_options"), searched: z.number(), excluded: ExclusionsSchema, errand: ErrandViewSchema }),
  z.object({ kind: z.literal("unknown_service"), knownServices: z.array(ServiceKindSchema), errand: ErrandViewSchema }),
  z.object({ kind: z.literal("unknown_area"), knownAreas: z.array(z.string()), errand: ErrandViewSchema }),
  z.object({ kind: z.literal("invalid_date_range"), reason: z.string(), errand: ErrandViewSchema }),
  z.object({ kind: z.literal("invalid_detail"), field: ErrandFieldSchema, reason: z.string(), errand: ErrandViewSchema }),
  z.object({ kind: z.literal("missing_details"), missing: z.array(RequiredFieldSchema), errand: ErrandViewSchema }),
  z.object({ kind: z.literal("not_editable"), errand: ErrandViewSchema }),
]);

/** GET /api/v1/sessions/:sessionId/errand. */
export const GetErrandResponseSchema = GetErrandOutputSchema;

export type ErrandState = z.infer<typeof ErrandStateSchema>;
export type ErrandField = z.infer<typeof ErrandFieldSchema>;
export type RequiredField = z.infer<typeof RequiredFieldSchema>;
export type UpdateErrandInput = z.infer<typeof UpdateErrandInputSchema>;
export type QuickReply = z.infer<typeof QuickReplySchema>;
export type ErrandQuestion = z.infer<typeof ErrandQuestionSchema>;
export type ErrandTransitionView = z.infer<typeof ErrandTransitionViewSchema>;
export type ErrandView = z.infer<typeof ErrandViewSchema>;
export type UpdateErrandOutput = z.infer<typeof UpdateErrandOutputSchema>;
export type GetErrandOutput = z.infer<typeof GetErrandOutputSchema>;
export type OptionTag = z.infer<typeof OptionTagSchema>;
export type ErrandOption = z.infer<typeof ErrandOptionSchema>;
export type ErrandSearchOutput = z.infer<typeof ErrandSearchOutputSchema>;
export type GetErrandResponse = z.infer<typeof GetErrandResponseSchema>;
