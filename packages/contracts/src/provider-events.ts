import { z } from "zod";

// Provider events on the wire (ticket 14): the dev route that makes the mock world emit a
// provider-cancelled event, and the message a notice puts in the person's chat.

/**
 * How a provider update starts in the chat. The backend writes it, not the person: the chat shows it
 * as an update, and memory never counts its words as the person's.
 */
export const PROVIDER_UPDATE_PREFIX = "Provider update:";

const EventIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{1,128}$/, "An event id is 1-128 letters, digits, '_', '.', ':' or '-'.");

/**
 * POST /api/v1/dev/world-events/provider-cancelled. Without `eventId` the world emits a new event;
 * with the id of an event it already sent, it redelivers that event (a duplicate delivery). `note`
 * is the provider's own free text: untrusted, stored with the event and never shown to the model.
 */
export const SimulateProviderCancellationRequestSchema = z.object({
  bookingId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Pass a booking id."),
  eventId: EventIdSchema.optional(),
  note: z.string().max(2_000).optional(),
});

export const NoticeSkipReasonSchema = z.enum(["unknown_booking", "past_booking", "not_cancelled", "already_cancelled", "already_notified"]);

export const ProviderEventOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("notified"), sessionId: z.string(), deliveryId: z.string(), resumed: z.boolean() }),
  z.object({ kind: z.literal("skipped"), reason: NoticeSkipReasonSchema }),
  z.object({
    kind: z.literal("duplicate"),
    decision: z.enum(["skipped", "notified"]),
    skipReason: NoticeSkipReasonSchema.nullable(),
    sessionId: z.string().nullable(),
  }),
]);

export const SimulateProviderCancellationResponseSchema = z.object({
  event: z.object({ eventId: z.string(), bookingId: z.string(), providerId: z.string(), occurredAt: z.string() }),
  outcome: ProviderEventOutcomeSchema,
});

export type SimulateProviderCancellationRequest = z.infer<typeof SimulateProviderCancellationRequestSchema>;
export type NoticeSkipReasonView = z.infer<typeof NoticeSkipReasonSchema>;
export type ProviderEventOutcomeView = z.infer<typeof ProviderEventOutcomeSchema>;
export type SimulateProviderCancellationResponse = z.infer<typeof SimulateProviderCancellationResponseSchema>;
