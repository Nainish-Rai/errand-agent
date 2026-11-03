import { z } from "zod";

// Run budgets and outcomes on the wire. Every run ends in one of these outcomes, written to the run
// trace as a `run_outcome` event. The dev-only routes let a scenario tighten the limits and fault
// the world, so the evals and the browser checks can prove the limits hold.

export const RunOutcomeKindSchema = z.enum(["completed", "needs_user", "verifying", "budget_exhausted", "failed"]);

export const BudgetLimitSchema = z.enum(["model_turns", "tool_calls", "wall_clock"]);

export const RunLimitsSchema = z.object({
  modelTurns: z.number().int().positive(),
  toolCalls: z.number().int().nonnegative(),
  wallClockMs: z.number().int().positive(),
});

/** PUT /api/v1/dev/run-limits. Applies to runs that start afterwards; `null` restores the defaults. */
export const SetRunLimitsRequestSchema = z.object({
  limits: RunLimitsSchema.partial().nullable(),
});

export const SetRunLimitsResponseSchema = z.object({
  limits: RunLimitsSchema,
});

export const WorldOperationSchema = z.enum([
  "searchProviders",
  "getProvider",
  "listBookings",
  "holdSlot",
  "releaseHold",
  "book",
  "getBookingStatus",
  "cancel",
  "reschedule",
]);

/** A world operation made slow, or made to throw an error nobody planned for. */
export const WorldFaultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("slow"), operation: WorldOperationSchema, delayMs: z.number().int().positive().max(600_000) }),
  z.object({ kind: z.literal("throw"), operation: WorldOperationSchema }),
]);

/** PUT /api/v1/dev/world-fault. Lasts until the next scenario switch; `null` clears it. */
export const InjectWorldFaultRequestSchema = z.object({
  fault: WorldFaultSchema.nullable(),
});

export const InjectWorldFaultResponseSchema = InjectWorldFaultRequestSchema;

export type RunOutcomeKind = z.infer<typeof RunOutcomeKindSchema>;
export type BudgetLimit = z.infer<typeof BudgetLimitSchema>;
export type RunLimits = z.infer<typeof RunLimitsSchema>;
export type SetRunLimitsRequest = z.infer<typeof SetRunLimitsRequestSchema>;
export type SetRunLimitsResponse = z.infer<typeof SetRunLimitsResponseSchema>;
export type WorldFault = z.infer<typeof WorldFaultSchema>;
export type InjectWorldFaultRequest = z.infer<typeof InjectWorldFaultRequestSchema>;
export type InjectWorldFaultResponse = z.infer<typeof InjectWorldFaultResponseSchema>;
