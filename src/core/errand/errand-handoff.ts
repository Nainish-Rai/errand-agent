import type { ServiceKind } from "../ports/provider-world";

// Each chat holds one errand. Once it's booked, a request for a different job can't change it, so
// the refused search becomes a New errand card in that chat. The person settles the card once:
// either the job moves to a new chat (which starts from the search's details), or they dismiss it.
// The settlement links the two chats both ways and survives reloads and restarts.

/** The chat a moved job came from, as the new chat names it ("your Indiranagar plumber chat"). */
export interface HandoffOrigin {
  readonly service?: ServiceKind;
  readonly area?: string;
}

interface CardSettlement {
  /** The chat that showed the card. */
  readonly fromSessionId: string;
  /** The refused search the card was built from; one settlement per card. */
  readonly toolCallId: string;
  readonly settledAtMs: number;
}

export interface MovedHandoff extends CardSettlement {
  readonly kind: "moved";
  readonly toSessionId: string;
  /** Copied when the job moved: errands live in memory, and the link must outlive a restart. */
  readonly origin: HandoffOrigin;
}

export interface DismissedHandoff extends CardSettlement {
  readonly kind: "dismissed";
}

export type ErrandHandoff = MovedHandoff | DismissedHandoff;
