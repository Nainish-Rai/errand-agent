import type { Errand } from "../errand/errand";
import { transitionTo, type ErrandState, type TracePlace, type TransitionReason } from "../errand/errand-workflow";
import type { Clock } from "../ports/clock";
import type { Hasher } from "../ports/hasher";
import type { IdSource } from "../ports/id-source";
import type { ProposalStore } from "../ports/proposal-store";
import type { ProviderWorld } from "../ports/provider-world";
import type { ErrandDependencies } from "./errand-session";

// What the hold, propose, approve, decline and execute use cases work with.

export interface ProposalDependencies {
  /** The session's errand, its catalog and trace; `errand.clock` stamps transitions on the trace. */
  readonly errand: ErrandDependencies;
  readonly world: ProviderWorld;
  readonly proposals: ProposalStore;
  readonly hasher: Hasher;
  readonly ids: IdSource;
  /**
   * The world's time. Holds expire by it, so grants do too. It differs from the trace's clock when
   * the evals pin the date.
   */
  readonly worldClock: Clock;
}

/** Moves the errand along the workflow. A refusal here is a bug in the calling use case, not an outcome. */
export function moved(errand: Errand, to: ErrandState, reason: TransitionReason, clock: Clock): Errand {
  const next = transitionTo(errand, to, reason, clock.now().getTime());
  if (next.kind === "illegal_transition") throw new Error(`The workflow refused ${next.from} → ${next.to}.`);
  return next.subject;
}

/** The errand without its hold: the slot was booked, released or lost. */
export function withoutHold(errand: Errand): Errand {
  const { hold: _hold, ...rest } = errand;
  return rest;
}

/** Where a change made outside any tool call (a click on the card) lands in the session's trace. */
export function sessionPlace(sessionId: string): TracePlace {
  return { traceId: sessionId, sessionId };
}
