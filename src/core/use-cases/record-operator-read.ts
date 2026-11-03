import type { Clock } from "../ports/clock";
import type { OperatorReadKind, OperatorReadLog } from "../ports/operator-read-log";

// Every time an operator opens a session's trace, context log or transcript, the read is recorded
// before the data is handed over, so there is no unrecorded way to read another person's session.

export interface OperatorReadDependencies {
  readonly reads: OperatorReadLog;
  /** Real time: an audit record is never stamped with an eval's pinned clock. */
  readonly clock: Clock;
}

export async function recordOperatorRead(
  dependencies: OperatorReadDependencies,
  read: { readonly operatorId: string; readonly sessionId: string; readonly kind: OperatorReadKind },
): Promise<void> {
  await dependencies.reads.record({ ...read, atMs: dependencies.clock.now().getTime() });
}
