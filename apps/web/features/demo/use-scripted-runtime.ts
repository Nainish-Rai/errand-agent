"use client";

import { useExternalStoreRuntime } from "@assistant-ui/react";
import { useSyncExternalStore } from "react";

import { convertEveMessage } from "@/features/chat/eve-message-converter";
import { textOf, type ChatRuntime } from "@/features/chat/use-eve-assistant-runtime";

import { demoState, stateVersion, subscribe } from "./demo-world";
import { sendToChat, stopChat } from "./scripted-chat";

// The demo's twin of useEveAssistantRuntime: assistant-ui's external-store runtime over the scripted
// chat's messages, which are eve's own message shapes, converted by the same convertEveMessage, so the
// thread and every tool renderer draw them exactly as they draw a live session.

export interface DemoSession {
  readonly id: string;
  send(text: string): Promise<void>;
}

const NO_MESSAGES: never[] = [];

export function useScriptedRuntime(session: DemoSession): ChatRuntime {
  const chat = useSyncExternalStore(
    subscribe,
    () => demoState().chats[session.id],
    () => undefined,
  );
  const activity = useSyncExternalStore(subscribe, stateVersion, () => 0);

  const runtime = useExternalStoreRuntime({
    messages: chat?.messages ?? NO_MESSAGES,
    convertMessage: convertEveMessage,
    isRunning: chat?.running ?? false,
    onNew: async (message) => {
      const text = textOf(message);
      if (text.length > 0) await sendToChat(session.id, text);
    },
    onCancel: async () => {
      stopChat(session.id);
    },
  });

  return {
    runtime,
    error: undefined,
    sendText: (text: string) => sendToChat(session.id, text),
    sessionId: session.id,
    activity,
  };
}
