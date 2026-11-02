import { ApiRequestError, type ApiClient, type ChatClient, type ChatTurn } from "@errand/client";

import { isSay, type ApproveClick, type User, type UserStep } from "./users/user";

// Drives one user against the backend, through the same client package the web app uses.

/** Guards against a user that never stops; no scenario comes close. */
const MAX_USER_STEPS = 20;

export interface ClickOutcome extends ApproveClick {
  readonly status: number;
  /** `approved`, or the API error code, e.g. `not_implemented` until ticket 05. */
  readonly code: string;
}

export interface Conversation {
  readonly sessionId: string;
  readonly turns: readonly ChatTurn[];
  readonly clicks: readonly ClickOutcome[];
  /** Every step the user took, in order: what a recording replays. */
  readonly steps: readonly UserStep[];
}

async function click(api: ApiClient, approve: ApproveClick): Promise<ClickOutcome> {
  try {
    await api.approveProposal(approve.proposalId, { fingerprint: approve.fingerprint });
    return { ...approve, status: 200, code: "approved" };
  } catch (error) {
    if (error instanceof ApiRequestError) return { ...approve, status: error.status, code: error.code };
    throw error;
  }
}

export async function converse(
  user: User,
  clients: { readonly api: ApiClient; readonly chat: ChatClient },
  signal: AbortSignal,
): Promise<Conversation> {
  const turns: ChatTurn[] = [];
  const clicks: ClickOutcome[] = [];
  const steps: UserStep[] = [];
  let sessionId: string | undefined;

  for (let taken = 0; taken < MAX_USER_STEPS; taken += 1) {
    const step = await user.nextStep(turns);
    if (step === undefined) break;
    steps.push(step);
    if (isSay(step)) {
      const turn =
        sessionId === undefined
          ? await clients.chat.sendFirstMessage(step.say, { signal })
          : await clients.chat.sendMessage(sessionId, step.say, { signal });
      sessionId = turn.sessionId;
      turns.push(turn);
    } else {
      clicks.push(await click(clients.api, step.approve));
    }
  }

  if (sessionId === undefined) throw new Error("The user never said anything, so there is no session to grade.");
  return { sessionId, turns, clicks, steps };
}
