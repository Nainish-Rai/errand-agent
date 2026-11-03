import type { DateRange } from "./provider-world";

/** A search_providers call as the chat session recorded it: its arguments and how it ended. */
export interface RecordedSearch {
  readonly service: string;
  readonly area: string;
  readonly dates: DateRange;
  /** The result's outcome kind (`not_editable`, `found`, …), or undefined while it has none. */
  readonly outcome?: string;
}

/**
 * The tool calls a chat session actually made, from the session's own record. The New errand card
 * names one by id; this is how core checks that the card's call is real and says what the card says.
 */
export interface SessionToolCalls {
  /** The session's search_providers call with that id, or undefined (no such call, or another tool). */
  searchCall(sessionId: string, toolCallId: string): Promise<RecordedSearch | undefined>;
}
