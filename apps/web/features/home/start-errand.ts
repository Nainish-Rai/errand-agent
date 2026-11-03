import { ChatClient } from "@errand/client";
import type { DraftErrandRequest } from "@errand/contracts";

import { appApi, backendUrl } from "@/features/chat/backend";

// Starting an errand from the home composer: a new chat session, the chips saved as its errand
// (DraftErrand) before anything reaches the model, then the person's words as its first message.
// The chat page attaches to the session and follows that first turn as it runs.

const chat = new ChatClient({ baseUrl: backendUrl });

export interface ComposedErrand {
  readonly text: string;
  readonly draft: DraftErrandRequest;
}

/** Returns the new session's id, for the chat's address. */
export async function startErrand(composed: ComposedErrand): Promise<string> {
  const session = await chat.startSession();
  // Awaited before the first message: the agent's first turn must already see the chips.
  await appApi.draftErrand(session.id, composed.draft);
  await session.send(composed.text);
  return session.id;
}
