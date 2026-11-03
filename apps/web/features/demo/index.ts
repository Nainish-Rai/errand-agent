import type { AppApi } from "@errand/client";

import type { ChatBackend } from "@/features/chat/chat-backend";

import { MockApiClient } from "./mock-api-client";
import { createChat, ensureChat, sendToChat } from "./scripted-chat";
import { useScriptedRuntime, type DemoSession } from "./use-scripted-runtime";

// Demo mode (NEXT_PUBLIC_ERRAND_DEMO=1, read only in features/chat/backend.ts): the real web app with
// no backend, no model and no key. The app API is answered in the browser from a recording of the real
// backend, and the chat plays recorded turns of it in answer to keywords. See docs/DEPLOY-DEMO.md.

export { DemoBanner } from "./demo-banner";
export { resetDemo } from "./demo-world";

function sessionOf(id: string): DemoSession {
  return { id, send: (text) => sendToChat(id, text) };
}

export interface DemoBackend {
  readonly api: AppApi;
  readonly chat: ChatBackend<DemoSession>;
}

export function createDemoBackend(): DemoBackend {
  return {
    api: new MockApiClient(),
    chat: {
      startSession: async () => sessionOf(createChat()),
      attachSession: (sessionId) => {
        ensureChat(sessionId);
        return sessionOf(sessionId);
      },
      useRuntime: useScriptedRuntime,
    },
  };
}
