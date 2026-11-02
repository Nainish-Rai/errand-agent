import type { ChatTurn } from "@errand/client";
import { z } from "zod";

// What a user does in a scenario: say something in the chat, or click Approve on an approval card
// through the same endpoint the web app's button calls.

export const ApproveClickSchema = z.object({
  proposalId: z.string().min(1),
  fingerprint: z.string().min(1),
});

export const UserStepSchema = z.union([
  z.object({ say: z.string().min(1) }),
  z.object({ approve: ApproveClickSchema }),
]);

export type ApproveClick = z.infer<typeof ApproveClickSchema>;
export type UserStep = z.infer<typeof UserStepSchema>;

export interface User {
  /** The next step given the turns so far, or undefined when the user is done. */
  nextStep(turns: readonly ChatTurn[]): Promise<UserStep | undefined>;
  /** What the user's own model calls cost so far, in US dollars (0 for scripted users). */
  readonly costUsd: number;
}

export function isSay(step: UserStep): step is { readonly say: string } {
  return "say" in step;
}
