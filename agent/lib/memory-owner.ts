import { localDev, routeAuth, type AuthFn } from "eve/channels/auth";

// Whose memory a request reads and writes. It always comes from the channel's auth context, never
// from a request body or a model's tool input. Locally that is eve's fixed `local-dev` caller;
// real auth later means changing CALLER_AUTH and nothing else.

/** The route auth walk shared by the chat channel and the app API, so both see the same person. */
export const CALLER_AUTH: readonly AuthFn<Request>[] = [localDev()];

interface Caller {
  readonly principalId: string;
  readonly principalType: string;
}

/** The memory owner for an authenticated caller, or undefined when no one is signed in. */
export function memoryOwnerOf(caller: Caller | null | undefined): string | undefined {
  return caller === null || caller === undefined ? undefined : `${caller.principalType}:${caller.principalId}`;
}

/** The app API's caller: the memory owner, or the walk's 401 response. */
export async function memoryOwnerOfRequest(request: Request): Promise<string | Response> {
  const caller = await routeAuth(request, CALLER_AUTH);
  if (caller instanceof Response) return caller;
  return memoryOwnerOf(caller) ?? Response.json({ error: { code: "unauthenticated", message: "Sign in first." } }, { status: 401 });
}
