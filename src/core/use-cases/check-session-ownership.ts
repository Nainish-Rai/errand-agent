import type { SessionOwnerStore } from "../ports/session-owner-store";

// The one rule every session-scoped read follows: the session belongs to the caller, or the caller
// is told it doesn't exist. Another person's session and an unknown id get the same answer, so a
// refusal never confirms that a session exists. Reads never claim: only a route that can start or
// continue a session does (claimSession).

export type SessionOwnershipOutcome = { readonly kind: "owned" } | { readonly kind: "not_found" };

export async function checkSessionOwnership(
  owners: SessionOwnerStore,
  request: { readonly sessionId: string; readonly userId: string },
): Promise<SessionOwnershipOutcome> {
  return (await owners.ownerOf(request.sessionId)) === request.userId ? { kind: "owned" } : { kind: "not_found" };
}
