import { ApiClient, DEFAULT_BACKEND_URL, type AppApi } from "@errand/client";
import type { ComponentType } from "react";

import { eveChatBackend, type ChatBackend } from "./chat-backend";

// Where the app reaches the backend: the one app API client its parts share, the chat backend, and the
// operator console's client. The only place the demo switch is read.

/**
 * Demo mode (NEXT_PUBLIC_ERRAND_DEMO=1, inlined at build time): the same UI with no backend, model or
 * key, for a hosted link. The app API and the chat are answered in the browser from a recording of
 * the real backend (features/demo). Off, everything below is the real backend, exactly as before.
 */
export const isDemo = process.env.NEXT_PUBLIC_ERRAND_DEMO === "1";

// Loaded only behind the switch, which the build inlines, so a build without it drops the demo and its
// recording entirely: a static import would ship them in every bundle.
const demo = isDemo ? (require("@/features/demo") as typeof import("@/features/demo")).createDemoBackend() : undefined;

/** The demo's always-visible banner; none outside demo mode. */
export const DemoBanner: ComponentType | undefined = demo?.Banner;

export const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? DEFAULT_BACKEND_URL;

export const appApi: AppApi = demo?.api ?? new ApiClient({ baseUrl: backendUrl });

export const chatBackend: ChatBackend = demo?.chat ?? eveChatBackend(backendUrl);

/** The operator console's client, sending the operator's token. In demo mode there is no token to send. */
export function operatorApi(accessToken: string): AppApi {
  return demo?.api ?? new ApiClient({ baseUrl: backendUrl, accessToken });
}
