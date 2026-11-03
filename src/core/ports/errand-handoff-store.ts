import type { ErrandHandoff, MovedHandoff } from "../errand/errand-handoff";

/** How each New errand card was settled, and which chat each moved job went to. */
export interface ErrandHandoffStore {
  /**
   * Records the card's settlement unless it already has one, and returns the one it has afterwards.
   * Atomic: two taps on one card (or a tap on each of its buttons) settle it once.
   */
  settle(handoff: ErrandHandoff): Promise<ErrandHandoff>;
  /** The cards settled in a chat, oldest first. */
  settledIn(fromSessionId: string): Promise<readonly ErrandHandoff[]>;
  /** The move that started a chat, if one did. */
  startedIn(toSessionId: string): Promise<MovedHandoff | undefined>;
}
