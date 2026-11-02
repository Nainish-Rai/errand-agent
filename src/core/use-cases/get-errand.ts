import type { Errand } from "../errand/errand";
import type { ErrandStore } from "../ports/errand-store";

/** The session's errand as it stands, or undefined when the person hasn't asked for anything yet. */
export function getErrand(errands: ErrandStore, sessionId: string): Promise<Errand | undefined> {
  return errands.find(sessionId);
}
