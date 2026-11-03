import { ApiRequestError, type ApiClient, type ChatClient, type ChatTurn } from "@errand/client";
import { CARD_FOLLOW_UPS } from "@errand/contracts";

import { latestCard } from "./approval-checks";
import { isApprove, isCardTap, isSay, type ApproveClick, type CardTap, type User, type UserStep } from "./users/user";

// Drives one user against the backend, through the same client package the web app uses.

/** Guards against a user that never stops; no scenario comes close. */
const MAX_USER_STEPS = 20;

export interface ClickOutcome extends ApproveClick {
  readonly status: number;
  /** `approved`, or the API error code, e.g. `fingerprint_mismatch`. */
  readonly code: string;
}

export interface TapOutcome {
  readonly tap: CardTap;
  /** The card's proposal, or undefined when no card was on screen to tap. */
  readonly proposalId?: string;
  readonly status: number;
  /** `approved` / `declined`, an API error code, or `no_card`. */
  readonly code: string;
}

export interface Conversation {
  /** The first chat session. A scenario that comes back later (`newSession`) has more in `sessionIds`. */
  readonly sessionId: string;
  /** Every chat session, in the order they started. */
  readonly sessionIds: readonly string[];
  readonly turns: readonly ChatTurn[];
  /** Hand-made approve requests (`{ approve: { proposalId, fingerprint } }` steps). */
  readonly clicks: readonly ClickOutcome[];
  /** Taps on the approval card in the chat (`{ card }` steps). */
  readonly taps: readonly TapOutcome[];
  /** Every step the user took, in order: what a recording replays. */
  readonly steps: readonly UserStep[];
}

export interface ConversationHooks {
  /**
   * Before the first message of each session after the first, with the number of messages already
   * said. The offline model counts turns per session, so the scenario reloads the rest of its script.
   */
  readonly beforeNewSession?: (messagesSoFar: number) => Promise<void>;
}

async function statusOf(call: () => Promise<unknown>, success: string): Promise<{ status: number; code: string }> {
  try {
    await call();
    return { status: 200, code: success };
  } catch (error) {
    if (error instanceof ApiRequestError) return { status: error.status, code: error.code };
    throw error;
  }
}

async function click(api: ApiClient, approve: ApproveClick): Promise<ClickOutcome> {
  return { ...approve, ...(await statusOf(() => api.approveProposal(approve.proposalId, { fingerprint: approve.fingerprint }), "approved")) };
}

const FOLLOW_UP: Readonly<Record<CardTap, string>> = {
  approve: CARD_FOLLOW_UPS.approved,
  decline: CARD_FOLLOW_UPS.declined,
  other_options: CARD_FOLLOW_UPS.otherOptions,
};

/**
 * What the web app's approval card does on a tap: read the proposal (the card renders from it),
 * call the approve or decline route, and only if that worked, send the follow-up message so the
 * agent takes its next step.
 */
async function tapCard(api: ApiClient, turns: readonly ChatTurn[], tap: CardTap): Promise<TapOutcome> {
  const card = latestCard(turns);
  if (card === undefined) return { tap, status: 0, code: "no_card" };
  const { proposalId } = card;
  if (tap === "approve") {
    const proposal = await api.getProposal(proposalId);
    return { tap, proposalId, ...(await statusOf(() => api.approveProposal(proposalId, { fingerprint: proposal.fingerprint }), "approved")) };
  }
  return { tap, proposalId, ...(await statusOf(() => api.declineProposal(proposalId), "declined")) };
}

export async function converse(
  user: User,
  clients: { readonly api: ApiClient; readonly chat: ChatClient },
  signal: AbortSignal,
  hooks: ConversationHooks = {},
): Promise<Conversation> {
  const turns: ChatTurn[] = [];
  const clicks: ClickOutcome[] = [];
  const taps: TapOutcome[] = [];
  const steps: UserStep[] = [];
  const sessionIds: string[] = [];
  let sessionId: string | undefined;

  const say = async (text: string) => {
    if (sessionId === undefined && sessionIds.length > 0) await hooks.beforeNewSession?.(turns.length);
    const turn =
      sessionId === undefined
        ? await clients.chat.sendFirstMessage(text, { signal })
        : await clients.chat.sendMessage(sessionId, text, { signal });
    if (sessionId === undefined) sessionIds.push(turn.sessionId);
    sessionId = turn.sessionId;
    turns.push(turn);
  };

  for (let taken = 0; taken < MAX_USER_STEPS; taken += 1) {
    const step = await user.nextStep(turns);
    if (step === undefined) break;
    steps.push(step);
    if (isSay(step)) await say(step.say);
    else if (isCardTap(step)) {
      const outcome = await tapCard(clients.api, turns, step.card);
      taps.push(outcome);
      if (outcome.status === 200) await say(FOLLOW_UP[step.card]);
    } else if (isApprove(step)) clicks.push(await click(clients.api, step.approve));
    else sessionId = undefined;
  }

  const [first] = sessionIds;
  if (first === undefined) throw new Error("The user never said anything, so there is no session to grade.");
  return { sessionId: first, sessionIds, turns, clicks, taps, steps };
}
