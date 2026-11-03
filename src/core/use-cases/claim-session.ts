import type { SessionOwnerStore } from "../ports/session-owner-store";

// A caller reaching a session through a route that can start or continue it (eve's chat routes, the
// home composer's draft) claims it if nobody has. Afterwards it is theirs alone.

export type ClaimSessionOutcome =
  | { readonly kind: "claimed" }
  | { readonly kind: "owned" }
  /** Someone else's session. Callers answer exactly as for a session that doesn't exist. */
  | { readonly kind: "not_found" };

export async function claimSession(
  owners: SessionOwnerStore,
  claim: { readonly sessionId: string; readonly userId: string; readonly atMs: number },
): Promise<ClaimSessionOutcome> {
  const before = await owners.ownerOf(claim.sessionId);
  if (before === claim.userId) return { kind: "owned" };
  if (before !== undefined) return { kind: "not_found" };
  const owner = await owners.claim({ sessionId: claim.sessionId, ownerId: claim.userId, claimedAtMs: claim.atMs });
  return owner === claim.userId ? { kind: "claimed" } : { kind: "not_found" };
}
