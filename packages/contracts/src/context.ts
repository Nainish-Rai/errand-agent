import { z } from "zod";

// The context log on the wire: GET /api/v1/sessions/:sessionId/context. One entry per model call:
// what was sent against the fixed context budget (tokens per part, the cap and the split), the
// remembered facts it carried and every fact it left out with the reason, and the history it kept,
// dropped and summarised.

export const ContextFactSchema = z.object({
  id: z.string(),
  key: z.string(),
  /** The key in words, e.g. "Area". */
  label: z.string(),
  value: z.string(),
  /** The value as the person reads it, e.g. "₹1,500". */
  display: z.string(),
  source: z.string(),
  status: z.string(),
  /** Why it was included (`fills_missing_detail`, ...) or excluded (`forgotten`, `unconfirmed`, `over_budget`, ...). */
  reason: z.string(),
});

export const ContextMessageSchema = z.object({
  /** Its position in the prompt eve built. */
  index: z.number(),
  role: z.string(),
  fromPerson: z.boolean(),
  tokens: z.number(),
  preview: z.string(),
});

export const ContextTokensSchema = z.object({
  instructions: z.number(),
  tools: z.number(),
  memory: z.number(),
  /** Kept history, the summary included. */
  history: z.number(),
  summary: z.number(),
  total: z.number(),
});

export const ContextSplitSchema = z.object({
  instructions: z.number(),
  memory: z.number(),
  history: z.number(),
});

export const ModelCallContextSchema = z.object({
  eventId: z.string(),
  sessionId: z.string(),
  turnId: z.string(),
  /** The call's chat span in the run trace. */
  spanId: z.string().nullable(),
  timeMs: z.number(),
  /** `refused`: the context didn't fit, so the call was never sent. */
  outcome: z.enum(["sent", "refused"]),
  overBudgetPart: z.enum(["instructions", "memory", "history"]).nullable(),
  /** How tokens were counted, e.g. `utf8_bytes/2` (a conservative estimate). */
  estimator: z.string(),
  capTokens: z.number(),
  split: ContextSplitSchema,
  tokens: ContextTokensSchema,
  historyLimitTokens: z.number(),
  instructions: z.array(z.object({ kind: z.string(), label: z.string(), tokens: z.number() })),
  memory: z.object({
    /** The memory message exactly as sent; empty when the call carried none. */
    text: z.string(),
    included: z.array(ContextFactSchema),
    excluded: z.array(ContextFactSchema),
    /** The memory clock's time the facts were filtered at. */
    nowMs: z.number().nullable(),
  }),
  history: z.object({
    kept: z.array(ContextMessageSchema),
    dropped: z.array(ContextMessageSchema),
    summary: z.string().nullable(),
  }),
  /** SHA-256 of the prompt exactly as sent. */
  promptSha256: z.string().nullable(),
});

export const GetSessionContextResponseSchema = z.object({
  sessionId: z.string(),
  calls: z.array(ModelCallContextSchema),
});

export type ContextFact = z.infer<typeof ContextFactSchema>;
export type ContextMessage = z.infer<typeof ContextMessageSchema>;
export type ContextTokens = z.infer<typeof ContextTokensSchema>;
export type ModelCallContext = z.infer<typeof ModelCallContextSchema>;
export type GetSessionContextResponse = z.infer<typeof GetSessionContextResponseSchema>;
