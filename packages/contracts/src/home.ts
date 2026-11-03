import { z } from "zod";

import { ErrandStateSchema, TimeWindowViewSchema } from "./errand";
import { MemoryFactViewSchema } from "./memory";
import { IsoDateSchema, ServiceKindSchema, SlotSchema } from "./world";

// The home screen on the wire: GET /api/v1/home (GetHomeSummary, every widget in one call) and
// POST /api/v1/sessions/:sessionId/errand (DraftErrand, the composer's chips before the first turn).
// Core keeps its own plain types; the agent's home presenter maps between the two.

/** An errand that isn't finished: Working now, and the composer's Running tab. */
export const ErrandAtWorkViewSchema = z.object({
  sessionId: z.string(),
  errandId: z.string(),
  state: ErrandStateSchema,
  /** `person` when it waits for their answer, choice or approval; `agent` while the agent works. */
  waitingOn: z.enum(["agent", "person"]),
  /** When it reached its current step. */
  since: z.string(),
  service: ServiceKindSchema.nullable(),
  area: z.string().nullable(),
  timeWindow: TimeWindowViewSchema.nullable(),
  budgetInr: z.number().nullable(),
});

/** A pending approval card in Waiting on you; it opens its chat at the card. */
export const PendingApprovalViewSchema = z.object({
  proposalId: z.string(),
  sessionId: z.string(),
  providerName: z.string(),
  service: ServiceKindSchema,
  slot: SlotSchema,
  priceInr: z.number(),
  holdSecondsLeft: z.number().int().nonnegative(),
});

export const UpcomingVisitViewSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("booked"),
    bookingId: z.string(),
    providerName: z.string(),
    service: ServiceKindSchema,
    slot: SlotSchema,
    priceInr: z.number(),
  }),
  /** Approved and sent to the provider; the world hasn't confirmed it, so it is never shown as booked. */
  z.object({
    kind: z.literal("checking"),
    proposalId: z.string(),
    sessionId: z.string(),
    providerName: z.string(),
    service: ServiceKindSchema,
    slot: SlotSchema,
    priceInr: z.number(),
  }),
]);

export const HomeAlertViewSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("provider_cancelled"),
    alertId: z.string(),
    bookingId: z.string(),
    providerName: z.string(),
    service: ServiceKindSchema,
    slot: SlotSchema,
    replacementsReady: z.number().int().nonnegative(),
    /** The newest replacement card waiting for approval, so the alert opens the chat at it. */
    proposalId: z.string().nullable(),
    /** A replacement was booked; the alert no longer counts on the bell. */
    rebooked: z.boolean(),
    sessionId: z.string().nullable(),
    at: z.string(),
  }),
  z.object({
    kind: z.literal("booking_recovered"),
    errandId: z.string(),
    sessionId: z.string(),
    service: ServiceKindSchema.nullable(),
    area: z.string().nullable(),
    at: z.string(),
  }),
  z.object({
    kind: z.literal("errand_failed"),
    errandId: z.string(),
    sessionId: z.string(),
    service: ServiceKindSchema.nullable(),
    area: z.string().nullable(),
    at: z.string(),
  }),
]);

export const ActivityDayViewSchema = z.object({
  date: IsoDateSchema,
  bookings: z.number().int().nonnegative(),
  bookedInr: z.number().nonnegative(),
});

export const MainModelViewSchema = z.object({
  provider: z.enum(["minimax", "scripted"]),
  modelId: z.string(),
});

/** GET /api/v1/home. */
export const GetHomeSummaryResponseSchema = z.object({
  generatedAt: z.string(),
  counts: z.object({
    running: z.number().int().nonnegative(),
    waitingOnYou: z.number().int().nonnegative(),
    /** The bell: alerts that need the person. */
    alerts: z.number().int().nonnegative(),
  }),
  working: z.array(ErrandAtWorkViewSchema),
  waiting: z.object({
    approvals: z.array(PendingApprovalViewSchema),
    /** Inferred facts waiting for the person to confirm them. */
    facts: z.array(MemoryFactViewSchema),
  }),
  upcoming: z.array(UpcomingVisitViewSchema),
  alerts: z.array(HomeAlertViewSchema),
  /** Visits per IST day: the six days before today, today and the seven after. */
  activity: z.object({ today: IsoDateSchema, days: z.array(ActivityDayViewSchema) }),
  /** Current facts: explicit, confirmed and still-unconfirmed guesses. */
  memory: z.array(MemoryFactViewSchema),
  /** What the composer's chips start from: the person's active preferences, the areas and the model. */
  composer: z.object({
    areas: z.array(z.string()),
    area: z.string().nullable(),
    budgetInr: z.number().nullable(),
    earliestHour: z.number().int().nullable(),
    model: MainModelViewSchema,
  }),
});

const HourSchema = z.number().int().min(0).max(24);

/**
 * POST /api/v1/sessions/:sessionId/errand: the composer's chips, sent before the session's first
 * message. `when` is this week (today through six days from today), within the hours when given.
 */
export const DraftErrandRequestSchema = z.object({
  area: z.string().trim().min(1).max(60).nullable(),
  budgetInr: z.number().positive().nullable(),
  when: z.object({ earliestHour: HourSchema.nullable(), latestHour: HourSchema.nullable() }).nullable(),
});

export type ErrandAtWorkView = z.infer<typeof ErrandAtWorkViewSchema>;
export type PendingApprovalView = z.infer<typeof PendingApprovalViewSchema>;
export type UpcomingVisitView = z.infer<typeof UpcomingVisitViewSchema>;
export type HomeAlertView = z.infer<typeof HomeAlertViewSchema>;
export type ActivityDayView = z.infer<typeof ActivityDayViewSchema>;
export type MainModelView = z.infer<typeof MainModelViewSchema>;
export type GetHomeSummaryResponse = z.infer<typeof GetHomeSummaryResponseSchema>;
export type DraftErrandRequest = z.infer<typeof DraftErrandRequestSchema>;
