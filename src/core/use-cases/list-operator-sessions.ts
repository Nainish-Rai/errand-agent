import type { Errand } from "../errand/errand";
import type { ErrandStore } from "../ports/errand-store";
import type { SessionOwnerStore, SessionOwnership } from "../ports/session-owner-store";

// The operator console's list: every owned session, newest first, with its errand so far.

export interface OperatorSession extends SessionOwnership {
  readonly errand: Errand | undefined;
}

export async function listOperatorSessions(dependencies: {
  readonly owners: SessionOwnerStore;
  readonly errands: ErrandStore;
}): Promise<readonly OperatorSession[]> {
  const sessions = await dependencies.owners.list();
  return Promise.all(sessions.map(async (session) => ({ ...session, errand: await dependencies.errands.find(session.sessionId) })));
}

