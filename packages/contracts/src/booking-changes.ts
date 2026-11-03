import { z } from "zod";

import { IsoDateSchema, ServiceKindSchema, SlotSchema } from "./world";

// The agent's tools for bookings the person already has: list_bookings (the assignment's tool,
// split into what is coming up and what is past) and find_reschedule_slots. Cancelling and moving
// still go through propose_action and a tap on the card.

export const ListBookingsInputSchema = z.object({});

/** A booking as the agent sees it. `area` is where its provider works, for "the same one as last time". */
export const BookingSummarySchema = z.object({
  bookingId: z.string(),
  providerId: z.string(),
  providerName: z.string(),
  service: ServiceKindSchema,
  area: z.string().nullable(),
  slot: SlotSchema,
  priceInr: z.number(),
  status: z.enum(["upcoming", "completed", "cancelled"]),
  /** Who cancelled a cancelled booking: the provider (ticket 14) or the person. */
  cancelledBy: z.enum(["provider", "person"]).nullable(),
});

export const ListBookingsOutputSchema = z.object({
  /** Bookings that can still be cancelled or moved, soonest first. */
  upcoming: z.array(BookingSummarySchema),
  /** Completed, cancelled or already started, most recent first. */
  past: z.array(BookingSummarySchema),
  message: z.string(),
});

export const FindRescheduleSlotsInputSchema = z.object({
  booking_id: z.string().min(1).describe("The upcoming booking to move, its bookingId from list_bookings."),
  from: IsoDateSchema.describe("First day to look at, inclusive, YYYY-MM-DD in IST."),
  to: IsoDateSchema.describe("Last day to look at, inclusive, YYYY-MM-DD in IST."),
});

export const FindRescheduleSlotsOutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("slots"), bookingId: z.string(), currentSlot: SlotSchema, slots: z.array(SlotSchema), message: z.string() }),
  z.object({ kind: z.literal("booking_not_found"), message: z.string() }),
  z.object({ kind: z.literal("not_changeable"), bookingId: z.string(), status: z.string(), message: z.string() }),
  z.object({ kind: z.literal("provider_not_found"), bookingId: z.string(), message: z.string() }),
  z.object({ kind: z.literal("invalid_date_range"), bookingId: z.string(), reason: z.string(), message: z.string() }),
]);

export type BookingSummary = z.infer<typeof BookingSummarySchema>;
export type ListBookingsOutput = z.infer<typeof ListBookingsOutputSchema>;
export type FindRescheduleSlotsInput = z.infer<typeof FindRescheduleSlotsInputSchema>;
export type FindRescheduleSlotsOutput = z.infer<typeof FindRescheduleSlotsOutputSchema>;
