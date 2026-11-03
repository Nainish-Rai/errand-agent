import { z } from "zod";

import { ErrandViewSchema } from "./errand";
import { SessionIdSchema } from "./trace";
import { SearchProvidersInputSchema, ServiceKindSchema } from "./world";

// New errand cards on the wire (ticket 24): GET and POST /api/v1/sessions/:sessionId/handoffs and
// POST /api/v1/sessions/:sessionId/handoffs/dismiss. A booked chat's refused search becomes a card;
// "Start in a new chat" moves the job to a new chat with the search's details as its errand, and
// "Not now" dismisses it. Both settle the card once, and the link between the chats survives a reload.

const ToolCallIdSchema = z.string().min(1).max(200);

export const ErrandHandoffViewSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("moved"), toolCallId: z.string(), toSessionId: z.string(), at: z.string() }),
  z.object({ kind: z.literal("dismissed"), toolCallId: z.string(), at: z.string() }),
]);

/** The chat a moved job came from, named by its errand when that was known. */
export const HandoffOriginViewSchema = z.object({
  sessionId: z.string(),
  service: ServiceKindSchema.nullable(),
  area: z.string().nullable(),
  at: z.string(),
});

/** GET /api/v1/sessions/:sessionId/handoffs. */
export const GetErrandHandoffsResponseSchema = z.object({
  /** How this chat's New errand cards were settled, oldest first. */
  settled: z.array(ErrandHandoffViewSchema),
  /** The chat this one was started from, or null. */
  startedFrom: HandoffOriginViewSchema.nullable(),
});

/**
 * POST /api/v1/sessions/:sessionId/handoffs: "Start in a new chat". `search` is the refused
 * search's arguments, exactly as the card read them; `toSessionId` is a new session of the caller's.
 */
export const StartNewErrandRequestSchema = z.object({
  toolCallId: ToolCallIdSchema,
  toSessionId: SessionIdSchema,
  search: SearchProvidersInputSchema,
});

export const StartNewErrandResponseSchema = z.object({
  /** Where the job is: the new chat, or the one an earlier tap already moved it to. */
  handoff: ErrandHandoffViewSchema,
  /** The new chat's errand as drafted, or null when nothing was carried over (or it moved earlier). */
  errand: ErrandViewSchema.nullable(),
});

/** POST /api/v1/sessions/:sessionId/handoffs/dismiss: "Not now". */
export const DismissNewErrandRequestSchema = z.object({ toolCallId: ToolCallIdSchema });

export const DismissNewErrandResponseSchema = z.object({ handoff: ErrandHandoffViewSchema });

export type ErrandHandoffView = z.infer<typeof ErrandHandoffViewSchema>;
export type HandoffOriginView = z.infer<typeof HandoffOriginViewSchema>;
export type GetErrandHandoffsResponse = z.infer<typeof GetErrandHandoffsResponseSchema>;
export type StartNewErrandRequest = z.infer<typeof StartNewErrandRequestSchema>;
export type StartNewErrandResponse = z.infer<typeof StartNewErrandResponseSchema>;
export type DismissNewErrandRequest = z.infer<typeof DismissNewErrandRequestSchema>;
export type DismissNewErrandResponse = z.infer<typeof DismissNewErrandResponseSchema>;
