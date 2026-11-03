import { z } from "zod";

import { ErrandViewSchema } from "./errand";

// The operator console's wire (ticket 19): GET /api/v1/ops/sessions, /ops/sessions/:id/transcript and
// /ops/sessions/:id/reads. Only an operator gets an answer; everyone else gets 404, as they do from
// the trace and context routes. Operators are callers whose access token's subject is on the
// backend's allow-list; the person's own chat never sends one.

/** The `iss` and `aud` of the access tokens the backend accepts (signed with ERRAND_AUTH_SECRET). */
export const ACCESS_TOKEN_ISSUER = "errand-agent";
export const ACCESS_TOKEN_AUDIENCE = "errand-agent-api";

export const OperatorSessionSchema = z.object({
  sessionId: z.string(),
  /** The person the session belongs to (the app's user id). */
  ownerId: z.string(),
  /** When its owner first reached it. */
  startedAt: z.string(),
  errand: ErrandViewSchema.nullable(),
});

export const ListOperatorSessionsResponseSchema = z.object({ sessions: z.array(OperatorSessionSchema) });

export const TranscriptMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  /** The message's text parts, joined; empty when it only called tools. */
  text: z.string(),
  /** The tools the message called, in order. Their inputs and outputs are in the trace. */
  tools: z.array(z.string()),
});

export const GetSessionTranscriptResponseSchema = z.object({
  sessionId: z.string(),
  messages: z.array(TranscriptMessageSchema),
});

export const OperatorReadKindSchema = z.enum(["trace", "context", "transcript"]);

export const OperatorReadSummarySchema = z.object({
  operatorId: z.string(),
  kind: OperatorReadKindSchema,
  reads: z.number().int().nonnegative(),
  firstReadAt: z.string(),
  lastReadAt: z.string(),
});

export const ListOperatorReadsResponseSchema = z.object({
  sessionId: z.string(),
  reads: z.array(OperatorReadSummarySchema),
});

export type OperatorSession = z.infer<typeof OperatorSessionSchema>;
export type ListOperatorSessionsResponse = z.infer<typeof ListOperatorSessionsResponseSchema>;
export type TranscriptMessage = z.infer<typeof TranscriptMessageSchema>;
export type GetSessionTranscriptResponse = z.infer<typeof GetSessionTranscriptResponseSchema>;
export type OperatorReadKind = z.infer<typeof OperatorReadKindSchema>;
export type OperatorReadSummary = z.infer<typeof OperatorReadSummarySchema>;
export type ListOperatorReadsResponse = z.infer<typeof ListOperatorReadsResponseSchema>;
