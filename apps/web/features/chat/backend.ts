import { ApiClient, DEFAULT_BACKEND_URL } from "@errand/client";

// Where the chat reaches the backend, and the one app API client its parts share.

export const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? DEFAULT_BACKEND_URL;

export const appApi = new ApiClient({ baseUrl: backendUrl });
