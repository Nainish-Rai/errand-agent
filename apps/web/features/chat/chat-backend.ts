import { ChatClient, type ClientSession } from "@errand/client";

import { useEveAssistantRuntime, type ChatRuntime } from "./use-eve-assistant-runtime";

// What the chat screens need from a chat backend: start or reopen a session, send the person's words,
// and bind the thread's runtime to it. The real one is eve over packages/client; the demo mode's is a
// scripted stand-in (features/demo). backend.ts picks one.

export interface ChatSession {
  readonly id: string;
  /** Sends the person's words; resolves once the backend has them, not when the turn ends. */
  send(text: string): Promise<unknown>;
}

export interface ChatBackend<Session extends ChatSession = ChatSession> {
  startSession(): Promise<Session>;
  attachSession(sessionId: string): Session;
  /** A React hook: the thread's runtime over the session. */
  useRuntime(session: Session): ChatRuntime;
}

/** The real chat: eve's session API at /eve/v1, through packages/client. */
export function eveChatBackend(baseUrl: string): ChatBackend<ClientSession> {
  const chat = new ChatClient({ baseUrl });
  return {
    startSession: () => chat.startSession(),
    attachSession: (sessionId) => chat.attachSession(sessionId),
    useRuntime: useEveAssistantRuntime,
  };
}
