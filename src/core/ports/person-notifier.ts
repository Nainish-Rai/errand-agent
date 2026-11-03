import type { CancelledVisit } from "../provider-events/provider-cancellation";

// How the backend speaks first: a message into the person's chat that starts a turn without them
// typing anything. The agent layer implements it on eve's sessions; core only says which chat,
// what happened and the key that makes a repeat a no-op.

export interface ProviderNotice {
  /** The same key for every attempt at this notice, so the chat takes it once. */
  readonly idempotencyKey: string;
  readonly visit: CancelledVisit;
}

export interface PersonNotifier {
  /**
   * A chat for a notice when the person has none to receive it: the same chat for the same key,
   * however often it is asked for.
   */
  openChat(key: string): Promise<{ readonly sessionId: string }>;
  /** Puts the notice in the chat as a provider update and starts the agent's turn on it. */
  notify(sessionId: string, notice: ProviderNotice): Promise<{ readonly deliveryId: string }>;
}
