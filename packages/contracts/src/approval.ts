import { z } from "zod";

import { ErrandViewSchema } from "./errand";
import { ServiceKindSchema, SlotSchema } from "./world";

// Holding a slot, proposals, grants and bookings on the wire: the hold_slot, propose_action and
// execute_proposal tools, and the /api/v1 proposal and booking routes. Core keeps its own plain
// types; the agent's approval presenter maps between the two.

export const ProposalStatusSchema = z.enum(["pending", "approved", "declined", "expired", "executing", "executed", "verifying", "failed"]);

/** Everything the approval card shows, as the world quoted it when the slot was held. */
export const BookingTermsViewSchema = z.object({
  action: z.literal("book"),
  providerId: z.string(),
  providerName: z.string(),
  service: ServiceKindSchema,
  rating: z.number(),
  area: z.string(),
  slot: SlotSchema,
  priceInr: z.number(),
  holdId: z.string(),
  holdExpiresAt: z.string(),
  cancellationTerms: z.string(),
});

/** A proposal as the agent sees it: no fingerprint, so nothing in the model's context can stand in for a click. */
export const ProposalCardSchema = z.object({
  proposalId: z.string(),
  status: ProposalStatusSchema,
  terms: BookingTermsViewSchema,
});

export const GrantViewSchema = z.object({
  grantId: z.string(),
  fingerprint: z.string(),
  expiresAt: z.string(),
  consumed: z.boolean(),
});

/** A proposal as the app API serves it to the card: its fingerprint, live status and grant. */
export const ProposalViewSchema = ProposalCardSchema.extend({
  sessionId: z.string(),
  fingerprint: z.string(),
  createdAt: z.string(),
  /** Seconds left on the hold by the world's clock; 0 once it has run out. */
  holdSecondsLeft: z.number().int().nonnegative(),
  bookingId: z.string().nullable(),
  grant: GrantViewSchema.nullable(),
});

// Tools.

export const HoldSlotInputSchema = z.object({
  provider_id: z.string().min(1).describe("The chosen option's providerId, exactly as search_providers returned it."),
  slot: SlotSchema.describe("The chosen slot, exactly as search_providers returned it."),
});

export const HeldSlotSchema = z.object({
  holdId: z.string(),
  providerId: z.string(),
  slot: SlotSchema,
  quotedPriceInr: z.number(),
  expiresAt: z.string(),
});

export const HoldSlotOutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("held"), hold: HeldSlotSchema, errand: ErrandViewSchema, message: z.string() }),
  z.object({ kind: z.literal("slot_unavailable"), errand: ErrandViewSchema, message: z.string() }),
  z.object({ kind: z.literal("provider_not_found"), errand: ErrandViewSchema, message: z.string() }),
  z.object({ kind: z.literal("not_choosing"), state: z.string().nullable(), message: z.string() }),
]);

export const ProposeActionInputSchema = z.object({
  action: z.literal("book").describe("What to propose. Only book is supported: it books the slot you just held."),
});

export const ProposeActionOutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("proposed"), proposal: ProposalCardSchema, message: z.string() }),
  z.object({ kind: z.literal("no_hold"), message: z.string() }),
  z.object({ kind: z.literal("hold_expired"), message: z.string() }),
  z.object({ kind: z.literal("provider_not_found"), message: z.string() }),
]);

export const ExecuteProposalInputSchema = z.object({});

export const ExecuteOutcomeKindSchema = z.enum([
  "booked",
  "already_booked",
  "not_approved",
  "no_proposal",
  "declined",
  "approval_expired",
  "fingerprint_mismatch",
  "grant_used",
  "out_of_step",
  "slot_taken",
  "verifying",
  "booking_failed",
]);

export const ExecuteProposalOutputSchema = z.object({
  kind: ExecuteOutcomeKindSchema,
  /** The proposal the outcome is about; on not_approved the chat shows its card again. */
  proposal: ProposalCardSchema.nullable(),
  /** Only on booked and already_booked: the ID get_booking_status confirmed. */
  bookingId: z.string().nullable(),
  /** What to tell the person, from the one outcome presenter. */
  message: z.string(),
});

// App API.

/** POST /proposals/:proposalId/decline. */
export const DeclineProposalResponseSchema = z.object({
  proposalId: z.string(),
  status: ProposalStatusSchema,
});

/** GET /proposals/:proposalId. */
export const GetProposalResponseSchema = z.object({ proposal: ProposalViewSchema });

/** GET /proposals?status=pending and GET /sessions/:sessionId/proposals, newest first. */
export const ListProposalsResponseSchema = z.object({ proposals: z.array(ProposalViewSchema) });

/** The approval behind a booking: which proposal and grant made it, and what the grant covered. */
export const BookingApprovalViewSchema = z.object({
  proposalId: z.string(),
  holdId: z.string(),
  proposalFingerprint: z.string(),
  grantId: z.string().nullable(),
  grantFingerprint: z.string().nullable(),
  grantConsumed: z.boolean(),
});

export const BookingViewSchema = z.object({
  bookingId: z.string(),
  providerId: z.string(),
  providerName: z.string(),
  service: ServiceKindSchema,
  slot: SlotSchema,
  priceInr: z.number(),
  status: z.enum(["upcoming", "completed", "cancelled"]),
  /** Null when no approved proposal made it (the seeded history). */
  approval: BookingApprovalViewSchema.nullable(),
});

/** GET /bookings: the person's bookings as the world has them, oldest slot first. */
export const ListBookingsResponseSchema = z.object({ bookings: z.array(BookingViewSchema) });

/**
 * What the chat sends as the person right after a click on the card, so the agent takes its next
 * step. The words carry no authority: execute_proposal checks for the grant the click minted.
 */
export const CARD_FOLLOW_UPS = {
  approved: "I approved it on the card.",
  declined: "I declined it.",
  otherOptions: "Show me other options.",
} as const;

export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;
export type BookingTermsView = z.infer<typeof BookingTermsViewSchema>;
export type ProposalCard = z.infer<typeof ProposalCardSchema>;
export type GrantView = z.infer<typeof GrantViewSchema>;
export type ProposalView = z.infer<typeof ProposalViewSchema>;
export type HoldSlotInput = z.infer<typeof HoldSlotInputSchema>;
export type HoldSlotOutput = z.infer<typeof HoldSlotOutputSchema>;
export type ProposeActionOutput = z.infer<typeof ProposeActionOutputSchema>;
export type ExecuteOutcomeKind = z.infer<typeof ExecuteOutcomeKindSchema>;
export type ExecuteProposalOutput = z.infer<typeof ExecuteProposalOutputSchema>;
export type DeclineProposalResponse = z.infer<typeof DeclineProposalResponseSchema>;
export type GetProposalResponse = z.infer<typeof GetProposalResponseSchema>;
export type ListProposalsResponse = z.infer<typeof ListProposalsResponseSchema>;
export type BookingApprovalView = z.infer<typeof BookingApprovalViewSchema>;
export type BookingView = z.infer<typeof BookingViewSchema>;
export type ListBookingsResponse = z.infer<typeof ListBookingsResponseSchema>;
