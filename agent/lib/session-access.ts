import { withAuthChallenges, type AuthFn } from "eve/channels/auth";

import { container } from "../../src/composition/container";
import { checkSessionOwnership } from "../../src/core/use-cases/check-session-ownership";
import { claimSession } from "../../src/core/use-cases/claim-session";
import { appUserOf } from "./app-user";

// Session ownership at the routes. eve checks who is calling but not whether they may use a given
// session, so every session-scoped route asks core (claimSession / checkSessionOwnership) and
// answers someone else's session exactly like an unknown one: 404, never 403, so a refusal can't
// confirm that a session exists.

const NOT_FOUND = { error: { code: "session_not_found", message: "No session of yours has that id." } };

/** The 404 every session-scoped route gives for a session that isn't the caller's. */
export function sessionNotFound(): Response {
  return Response.json(NOT_FOUND, { status: 404, headers: { "cache-control": "no-store" } });
}

/** True when the session belongs to the caller. Never claims: reads must not make a session theirs. */
export async function isCallersSession(sessionId: string, userId: string): Promise<boolean> {
  return (await checkSessionOwnership(container().sessionOwners, { sessionId, userId })).kind === "owned";
}

/**
 * For routes that start or continue a session: the caller claims it if nobody has, and gets false
 * when it is someone else's.
 */
export async function claimCallersSession(sessionId: string, userId: string): Promise<boolean> {
  const outcome = await claimSession(container().sessionOwners, { sessionId, userId, atMs: container().wallClock.now().getTime() });
  return outcome.kind !== "not_found";
}

/** eve's chat routes that name a session: send, stream, cancel, compact, clear, end. */
const EVE_SESSION_PATH = /^\/eve\/v1\/session\/([^/]+)(?:\/|$)/;

class SessionNotFoundError extends Error {
  readonly response = sessionNotFound();
}

interface Caller {
  readonly principalId: string;
  readonly principalType: string;
}

/**
 * Wraps the chat channel's auth walk so a caller can reach only their own sessions. Creating a
 * session names none; the creator's first request that names it (its first message, or attaching
 * to its stream) claims it, and anyone else's request for it is answered 404.
 */
export function ownSessionsOnly(walk: readonly AuthFn<Request>[]): AuthFn<Request> {
  return withAuthChallenges(
    async (request) => {
      let caller: Awaited<ReturnType<AuthFn<Request>>> = null;
      for (const authenticate of walk) {
        caller = await authenticate(request);
        if (caller) break;
      }
      if (!caller) return null;
      const sessionId = new URL(request.url).pathname.match(EVE_SESSION_PATH)?.[1];
      if (sessionId === undefined) return caller;
      const userId = appUserOf(caller as Caller);
      if (userId === undefined || !(await claimCallersSession(decodeURIComponent(sessionId), userId))) throw new SessionNotFoundError();
      return caller;
    },
    [{ scheme: "Bearer" }],
  );
}
