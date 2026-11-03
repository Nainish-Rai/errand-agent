import type { GetSessionTranscriptResponse, TranscriptMessage } from "@errand/contracts";
import { conversationOf, type SessionStreamEvent } from "eve/client";
import { sessions } from "eve/server";

// A session's conversation for the operator console: eve's own record of it, read in process (the
// person's chat replays the same stream). Read-only: what each message said and which tools it
// called. Tool inputs and outputs stay in the trace, which sanitises them.

/** Reads the session's stream as far as it goes now, without waiting for more. */
async function recordedEvents(sessionId: string): Promise<SessionStreamEvent[]> {
  const events: SessionStreamEvent[] = [];
  for await (const event of sessions.attach(sessionId).stream({ follow: false })) events.push(event);
  return events;
}

export async function presentSessionTranscript(sessionId: string): Promise<GetSessionTranscriptResponse> {
  const { messages } = conversationOf(await recordedEvents(sessionId));
  const transcript = messages.flatMap((message): TranscriptMessage[] => {
    if (message.role !== "user" && message.role !== "assistant") return [];
    const text = message.parts
      .flatMap((part) => (part.type === "text" ? [part.text.trim()] : []))
      .filter(Boolean)
      .join("\n\n");
    const tools = message.parts.flatMap((part) => (part.type === "tool" ? [part.name] : []));
    return [{ role: message.role, text, tools }];
  });
  return { sessionId, messages: transcript };
}
