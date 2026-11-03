import type { OperatorReadLog, OperatorReadSummary } from "../ports/operator-read-log";

/** Who has read the session's trace, context log and transcript, for the console's access log. */
export function listOperatorReads(reads: OperatorReadLog, sessionId: string): Promise<readonly OperatorReadSummary[]> {
  return reads.summarize(sessionId);
}
