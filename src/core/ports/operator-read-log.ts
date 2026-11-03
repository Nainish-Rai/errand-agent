// The audit trail of operator reads: who opened which session's trace, context log or transcript,
// and when. Every read is one record; the console shows them summed up per operator and kind.

export type OperatorReadKind = "trace" | "context" | "transcript";

export interface OperatorRead {
  readonly operatorId: string;
  readonly sessionId: string;
  readonly kind: OperatorReadKind;
  readonly atMs: number;
}

export interface OperatorReadSummary {
  readonly operatorId: string;
  readonly kind: OperatorReadKind;
  readonly reads: number;
  readonly firstAtMs: number;
  readonly lastAtMs: number;
}

export interface OperatorReadLog {
  record(read: OperatorRead): Promise<void>;
  /** The session's reads per operator and kind, the most recent first. */
  summarize(sessionId: string): Promise<readonly OperatorReadSummary[]>;
}
