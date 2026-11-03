import { z } from "zod";

import { ErrandOptionSchema, ErrandViewSchema } from "./errand";
import { ServiceKindSchema, SlotSchema } from "./world";

// Holding a slot, proposals, grants and bookings on the wire: the hold_slot, propose_action and
// execute_proposal tools, and the /api/v1 proposal and booking routes. Core keeps its own plain
// types; the agent's approval presenter maps between the two.

export const ProposalStatusSchema = z.enum([
  "pending",
  "approved",
  "declined",
  "expired",
  "voided",
  "executing",
  "executed",
  "verifying",
  "failed",
]);

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
  /** The terms it covered changed before it was used, so it can never book anything. */
  voided: z.boolean(),
});

const ProviderRefSchema = z.object({ providerId: z.string(), providerName: z.string() });

/** One approved term the provider changed before the booking: the old value beside the new one. */
export const TermChangeViewSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("price"), from: z.number(), to: z.number() }),
  z.object({ field: z.literal("slot"), from: SlotSchema, to: SlotSchema }),
  z.object({ field: z.literal("provider"), from: ProviderRefSchema, to: ProviderRefSchema }),
]);

/** Why a proposal was replaced: what changed (nothing, when only the hold ran out) and by which proposal. */
export const ProposalInvalidationViewSchema = z.object({
  changes: z.array(TermChangeViewSchema),
  replacedBy: z.string(),
  at: z.string(),
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
  /** Set when the proposal was voided or its hold ran out and a fresh proposal replaced it. */
  invalidation: ProposalInvalidationViewSchema.nullable(),
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
  /** The errand replaces a booking that provider cancelled (ticket 14), so it can't be held again. */
  z.object({ kind: z.literal("provider_excluded"), errand: ErrandViewSchema, message: z.string() }),
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
  "out_of_step",
  "slot_taken",
  "verifying",
  "booking_failed",
  "approval_invalidated",
  "hold_reproposed",
  "hold_lost",
]);

export const ExecuteProposalOutputSchema = z.object({
  kind: ExecuteOutcomeKindSchema,
  /** The proposal the outcome is about; on not_approved the chat shows its card again. */
  proposal: ProposalCardSchema.nullable(),
  /** On approval_invalidated and hold_reproposed: what the provider changed, old value beside new. */
  changes: z.array(TermChangeViewSchema),
  /** On approval_invalidated and hold_reproposed: the fresh proposal on the live terms, shown as a new card. */
  freshProposal: ProposalCardSchema.nullable(),
  /** Only on booked and already_booked: the ID get_booking_status confirmed. */
  bookingId: z.string().nullable(),
  /** Only on slot_taken: the next options. Picking one shows a new approval card. */
  options: z.array(ErrandOptionSchema).optional(),
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
  /** Who cancelled a cancelled booking, when the world knows (a provider's cancellation is ticket 14's). */
  cancelledBy: z.enum(["provider", "person"]).nullable().optional(),
  /** Null when no approved proposal made it (the seeded history). */
  approval: BookingApprovalViewSchema.nullable(),
});

/** GET /bookings: the person's bookings as the world has them, oldest slot first. */
export const ListBookingsResponseSchema = z.object({ bookings: z.array(BookingViewSchema) });

/** The action ledger's record of one booking attempt: written before `book`, settled by `get_booking_status`. */
export const ActionIntentStateSchema = z.enum(["pending", "confirmed", "failed", "unknown"]);

export const ActionIntentViewSchema = z.object({
  idempotencyKey: z.string(),
  action: z.literal("book"),
  proposalId: z.string(),
  grantId: z.string(),
  sessionId: z.string(),
  holdId: z.string(),
  state: ActionIntentStateSchema,
  /** How many times `book` was sent, always with `idempotencyKey`. */
  attempts: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastAttemptAt: z.string().nullable(),
  bookingId: z.string().nullable(),
  failureReason: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  /** `execution` when the run that booked settled it; `reconciler` when it was settled later (a timeout, a restart). */
  resolvedBy: z.enum(["execution", "reconciler"]).nullable(),
  /**
   * A settlement the reconciler reached outside the person's turn, in the one presenter's words.
   * The chat shows it as a booking update; null until there is one.
   */
  notice: z.string().nullable(),
  noticeDeliveredAt: z.string().nullable(),
});

/** GET /action-intents (every intent of the caller) and GET /sessions/:sessionId/action-intents, oldest first. */
export const ListActionIntentsResponseSchema = z.object({ intents: z.array(ActionIntentViewSchema) });

/**
 * What the person is promised while a booking's outcome is unknown: the verifying message ends
 * with it, and the chat's verification banner repeats it. Nothing books twice, and the update
 * comes in the chat.
 */
export const VERIFYING_PROMISE = "I'll update you here as soon as the provider confirms, and I won't book it twice.";

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
export type TermChangeView = z.infer<typeof TermChangeViewSchema>;
export type ProposalInvalidationView = z.infer<typeof ProposalInvalidationViewSchema>;
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
export type ActionIntentState = z.infer<typeof ActionIntentStateSchema>;
export type ActionIntentView = z.infer<typeof ActionIntentViewSchema>;
export type ListActionIntentsResponse = z.infer<typeof ListActionIntentsResponseSchema>;
