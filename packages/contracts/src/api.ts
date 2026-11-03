import { z } from "zod";

import { ProviderDetailsSchema } from "./world";

// Request and response bodies of the app API at /api/v1.

export const API_PREFIX = "/api/v1";

export const ApiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

/** A route that exists in the contract but whose use case hasn't landed yet answers 501 with this code. */
export const NOT_IMPLEMENTED_ERROR_CODE = "not_implemented";

/** POST /proposals/:proposalId/approve. The fingerprint is the one the approval card showed. */
export const ApproveProposalRequestSchema = z.object({
  fingerprint: z.string().min(1),
});

export const ApproveProposalResponseSchema = z.object({
  proposalId: z.string(),
  grantId: z.string(),
  expiresAt: z.string(),
});

export const GetProvidersResponseSchema = z.object({
  providers: z.array(ProviderDetailsSchema),
});

export const GetProviderResponseSchema = z.object({
  provider: ProviderDetailsSchema,
});

export const ScenarioNameSchema = z.enum([
  "default",
  "happy_path",
  "slot_taken",
  "timeout_after_success",
  "timeout_without_booking",
  "price_changed_on_hold",
  "slot_changed_after_approval",
  "hold_expired",
  "reschedule_conflict",
  "review_injection",
  "new_user",
  "untrusted_images",
]);

export const SwitchScenarioRequestSchema = z.object({
  scenario: ScenarioNameSchema,
  seed: z.number().int().nonnegative(),
});

export const SwitchScenarioResponseSchema = SwitchScenarioRequestSchema;

export type ApiError = z.infer<typeof ApiErrorSchema>;
export type ApproveProposalRequest = z.infer<typeof ApproveProposalRequestSchema>;
export type ApproveProposalResponse = z.infer<typeof ApproveProposalResponseSchema>;
export type GetProvidersResponse = z.infer<typeof GetProvidersResponseSchema>;
export type GetProviderResponse = z.infer<typeof GetProviderResponseSchema>;
export type ScenarioName = z.infer<typeof ScenarioNameSchema>;
export type SwitchScenarioRequest = z.infer<typeof SwitchScenarioRequestSchema>;
export type SwitchScenarioResponse = z.infer<typeof SwitchScenarioResponseSchema>;
