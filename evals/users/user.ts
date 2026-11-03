import type { ChatTurn } from "@errand/client";
import { z } from "zod";

// What a user does in a scenario: say something in the chat, tap a button on the approval card the
// chat is showing (through the same endpoints, and with the same follow-up message, as the web
// app's card), send a hand-made approve request with an explicit proposal and fingerprint, come
// back later in a new chat session, or tap generated UI: Choose on a provider card, fill and
// send the missing-details form, or pick an option.

export const ApproveClickSchema = z.object({
  proposalId: z.string().min(1),
  fingerprint: z.string().min(1),
});

/** A tap on the latest approval card in the chat: Approve, Decline or Other options. */
export const CardTapSchema = z.enum(["approve", "decline", "other_options"]);

/** What the person fills into the missing-details form; only the fields the form shows are sent. */
export const AskAnswerSchema = z.object({
  service: z.string().min(1).optional(),
  area: z.string().min(1).optional(),
  timeWindow: z.string().min(1).optional(),
  budgetInr: z.number().int().positive().optional(),
});

export const UserStepSchema = z.union([
  z.object({ say: z.string().min(1) }),
  z.object({ approve: ApproveClickSchema }),
  z.object({ card: CardTapSchema }),
  /** The next message starts a new chat session, as a person coming back another day would. */
  z.object({ newSession: z.literal(true) }),
  /** Choose on the provider card with this id. */
  z.object({ choose: z.string().min(1) }),
  z.object({ ask: AskAnswerSchema }),
  /** An option of the latest pick-one list, by its label. */
  z.object({ pick: z.string().min(1) }),
]);

export type ApproveClick = z.infer<typeof ApproveClickSchema>;
export type CardTap = z.infer<typeof CardTapSchema>;
export type AskAnswer = z.infer<typeof AskAnswerSchema>;
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

export function isCardTap(step: UserStep): step is { readonly card: CardTap } {
  return "card" in step;
}

export function isApprove(step: UserStep): step is { readonly approve: ApproveClick } {
  return "approve" in step;
}
