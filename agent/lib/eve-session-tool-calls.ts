import { SearchProvidersInputSchema } from "@errand/contracts";
import { conversationOf, type SessionStreamEvent } from "eve/client";
import { sessions } from "eve/server";

import type { RecordedSearch, SessionToolCalls } from "../../src/core/ports/session-tool-calls";

// The tool calls a chat really made, from eve's own record of the session (the stream the chat
// replays), read in process. A New errand card names a search by id; core checks it here (ticket 24).

async function recordedEvents(sessionId: string): Promise<SessionStreamEvent[]> {
  const events: SessionStreamEvent[] = [];
  for await (const event of sessions.attach(sessionId).stream({ follow: false })) events.push(event);
  return events;
}

function outcomeOf(output: unknown): string | undefined {
  if (typeof output !== "object" || output === null) return undefined;
  const kind = (output as { readonly kind?: unknown }).kind;
  return typeof kind === "string" ? kind : undefined;
}

export const eveSessionToolCalls: SessionToolCalls = {
  async searchCall(sessionId: string, toolCallId: string): Promise<RecordedSearch | undefined> {
    const { messages } = conversationOf(await recordedEvents(sessionId));
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      for (const part of message.parts) {
        if (part.type !== "tool" || part.callId !== toolCallId) continue;
        if (part.name !== "search_providers") return undefined;
        const input = SearchProvidersInputSchema.safeParse(part.input);
        if (!input.success) return undefined;
        const outcome = outcomeOf(part.output);
        return { service: input.data.service, area: input.data.area, dates: input.data.date_range, ...(outcome === undefined ? {} : { outcome }) };
      }
    }
    return undefined;
  },
};
