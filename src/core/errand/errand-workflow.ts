import type { TraceEvent } from "../ports/trace-sink";

// The errand workflow: an explicit state machine. Every change of state goes through
// `transitionTo`, which refuses any move the table below doesn't allow, and every accepted move
// is kept on the errand and written to the run trace.
//
//   gathering → searching → choosing → holding → awaiting_approval → executing → verifying → done
//
// A run that fails moves its errand to `failed` from any state that isn't finished (ticket 08).
// Ticket 04 drives gathering, searching and choosing. The later states are declared now so the
// booking tickets add behaviour, not states, and so the table already says what they may reach.

export type ErrandState =
  | "gathering"
  | "searching"
  | "choosing"
  | "holding"
  | "awaiting_approval"
  | "executing"
  | "verifying"
  | "done"
  | "failed"
  | "cancelled";

export type TransitionReason =
  /** The errand was opened; the only transition with no `from`. */
  | "errand_started"
  | "search_started"
  | "options_found"
  /** Nothing in the world fits the budget and time window. */
  | "no_options"
  /** The world refused the search (unknown service or area, bad dates). */
  | "search_rejected"
  /** A detail changed while options were on screen, so they are stale. */
  | "details_changed"
  | "slot_held"
  | "hold_lost"
  | "proposal_shown"
  | "proposal_declined"
  | "proposal_voided"
  | "approved"
  | "awaiting_verification"
  | "booking_verified"
  | "booking_failed"
  | "cancelled_by_user"
  /** The run ended `failed` (an unexpected tool error, an exhausted retry), so the errand did too. */
  | "run_failed";

const ALLOWED: Readonly<Record<ErrandState, readonly ErrandState[]>> = {
  gathering: ["searching", "cancelled", "failed"],
  searching: ["choosing", "gathering", "failed"],
  choosing: ["searching", "gathering", "holding", "cancelled", "failed"],
  holding: ["awaiting_approval", "choosing", "failed", "cancelled"],
  awaiting_approval: ["executing", "choosing", "holding", "cancelled", "failed"],
  executing: ["verifying", "done", "failed"],
  verifying: ["done", "failed"],
  done: [],
  failed: [],
  cancelled: [],
};

/** States in which the person may still change the errand's details. */
const EDITABLE: readonly ErrandState[] = ["gathering", "searching", "choosing"];

export interface ErrandTransition {
  /** Position in the errand's history, from 0 (the start). */
  readonly sequence: number;
  /** Absent only for the transition that starts the errand. */
  readonly from?: ErrandState;
  readonly to: ErrandState;
  readonly reason: TransitionReason;
  readonly atMs: number;
}

export interface WorkflowSubject {
  readonly state: ErrandState;
  readonly transitions: readonly ErrandTransition[];
}

export type TransitionOutcome<T extends WorkflowSubject> =
  | { readonly kind: "transitioned"; readonly subject: T; readonly transition: ErrandTransition }
  | { readonly kind: "illegal_transition"; readonly from: ErrandState; readonly to: ErrandState };

export function canTransition(from: ErrandState, to: ErrandState): boolean {
  return ALLOWED[from].includes(to);
}

export function isEditable(state: ErrandState): boolean {
  return EDITABLE.includes(state);
}

export function isFinished(state: ErrandState): boolean {
  return ALLOWED[state].length === 0;
}

export function startingTransition(atMs: number): ErrandTransition {
  return { sequence: 0, to: "gathering", reason: "errand_started", atMs };
}

export function transitionTo<T extends WorkflowSubject>(
  subject: T,
  to: ErrandState,
  reason: TransitionReason,
  atMs: number,
): TransitionOutcome<T> {
  if (!canTransition(subject.state, to)) return { kind: "illegal_transition", from: subject.state, to };
  const transition: ErrandTransition = { sequence: subject.transitions.length, from: subject.state, to, reason, atMs };
  return {
    kind: "transitioned",
    subject: { ...subject, state: to, transitions: [...subject.transitions, transition] },
    transition,
  };
}

/** Where in the run trace a transition happened: the trace, the session and the tool call. */
export interface TracePlace {
  readonly traceId: string;
  readonly sessionId: string;
  readonly spanId?: string;
}

/** A transition as a `state_transition` event of the run trace. */
export function transitionEvent(errandId: string, transition: ErrandTransition, place: TracePlace): TraceEvent {
  return {
    type: "event",
    traceId: place.traceId,
    eventId: `${errandId}:transition:${transition.sequence}`,
    sessionId: place.sessionId,
    ...(place.spanId === undefined ? {} : { spanId: place.spanId }),
    kind: "state_transition",
    name: `${transition.from ?? "start"} → ${transition.to}`,
    timeMs: transition.atMs,
    attributes: {
      "errand.id": errandId,
      "errand.state.from": transition.from ?? null,
      "errand.state.to": transition.to,
      "errand.transition.reason": transition.reason,
      "errand.transition.sequence": transition.sequence,
    },
  };
}
