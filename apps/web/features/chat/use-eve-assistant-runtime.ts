"use client";

import { useExternalStoreRuntime, type AppendMessage } from "@assistant-ui/react";
import type { ClientSession } from "@errand/client";
import { useEveAgent } from "eve/react";

import { convertEveMessage } from "./eve-message-converter";

function textOf(message: AppendMessage): string {
  return message.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
}

/**
 * assistant-ui's external-store runtime over eve's useEveAgent. eve owns the conversation state
 * (messages, status, streaming); assistant-ui only renders it and reports what the person typed.
 * The session comes from the client package, so every request goes through it. eve replays the
 * session's stream on mount and follows a turn still running, so a chat reopened from a link (or
 * started from the home composer, which sends the first message itself) shows its conversation.
 */
export function useEveAssistantRuntime(session: ClientSession) {
  const agent = useEveAgent({ session, resume: true });

  const runtime = useExternalStoreRuntime({
    messages: agent.messages,
    convertMessage: convertEveMessage,
    isRunning: agent.status === "busy",
    isDisabled: agent.status === "resuming",
    onNew: async (message) => {
      const text = textOf(message);
      if (text.length > 0) await agent.send(text);
    },
    onCancel: async () => {
      await agent.cancel();
    },
  });

  return {
    runtime,
    error: agent.error,
    /** Sends text as the person, the same way the composer does (quick-reply chips use it). */
    sendText: async (text: string) => {
      await agent.send(text);
    },
    /** The session eve is streaming, which the trace panel follows from the first message on. */
    sessionId: agent.session?.sessionId ?? session.id,
    /** Grows with every event the session streams, so the trace panel can refresh at once. */
    activity: agent.events.length,
  };
}
