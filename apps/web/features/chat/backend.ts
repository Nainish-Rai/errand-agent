import { ApiClient, DEFAULT_BACKEND_URL, type AppApi } from "@errand/client";

import { createDemoBackend } from "@/features/demo";

import { eveChatBackend, type ChatBackend } from "./chat-backend";

// Where the app reaches the backend: the one app API client its parts share, the chat backend, and the
// operator console's client. The only place the demo switch is read.

/**
 * Demo mode (NEXT_PUBLIC_ERRAND_DEMO=1, inlined at build time): the same UI with no backend, model or
 * key, for a hosted link. The app API and the chat are answered in the browser from a recording of
 * the real backend (features/demo). Off, everything below is the real backend, exactly as before.
 */
export const isDemo = process.env.NEXT_PUBLIC_ERRAND_DEMO === "1";

const demo = isDemo ? createDemoBackend() : undefined;

export const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? DEFAULT_BACKEND_URL;

export const appApi: AppApi = demo?.api ?? new ApiClient({ baseUrl: backendUrl });

export const chatBackend: ChatBackend = demo?.chat ?? eveChatBackend(backendUrl);

/** The operator console's client, sending the operator's token. In demo mode there is no token to send. */
export function operatorApi(accessToken: string): AppApi {
  return demo?.api ?? new ApiClient({ baseUrl: backendUrl, accessToken });
}
