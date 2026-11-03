import type { ErrandHandoff, MovedHandoff } from "../errand/errand-handoff";
import type { ErrandHandoffStore } from "../ports/errand-handoff-store";

// A chat's side of its hand-offs: how its New errand cards were settled ("Moved to a new chat"),
// and the chat it was started from ("Started from your Indiranagar plumber chat").

export interface ErrandHandoffs {
  readonly settled: readonly ErrandHandoff[];
  readonly startedFrom?: MovedHandoff;
}

export async function listErrandHandoffs(handoffs: ErrandHandoffStore, sessionId: string): Promise<ErrandHandoffs> {
  const [settled, startedFrom] = await Promise.all([handoffs.settledIn(sessionId), handoffs.startedIn(sessionId)]);
  return { settled, ...(startedFrom === undefined ? {} : { startedFrom }) };
}
