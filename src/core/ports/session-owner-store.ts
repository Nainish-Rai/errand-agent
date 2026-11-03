// Who each chat session belongs to. eve hands a session id to whoever created the session and adds
// no access list of its own ("your application decides who may use a session"), so the backend
// keeps one: the first signed-in caller to reach a session owns it, and nobody else may read it.

export interface SessionOwnership {
  readonly sessionId: string;
  /** The app's user id (the world's person), never a memory owner key. */
  readonly ownerId: string;
  readonly claimedAtMs: number;
}

export interface SessionOwnerStore {
  /**
   * Records `ownerId` as the session's owner unless it already has one, and returns the owner the
   * session has afterwards. Atomic: two first callers can't both own one session.
   */
  claim(claim: SessionOwnership): Promise<string>;
  ownerOf(sessionId: string): Promise<string | undefined>;
  /** Every owned session, newest first. */
  list(): Promise<readonly SessionOwnership[]>;
}
