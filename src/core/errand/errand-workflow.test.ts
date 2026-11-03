import { describe, expect, it } from "vitest";

import {
  canTransition,
  isFinished,
  startingTransition,
  transitionEvent,
  transitionTo,
  type ErrandState,
  type WorkflowSubject,
} from "./errand-workflow";

const STATES: readonly ErrandState[] = [
  "gathering",
  "searching",
  "choosing",
  "holding",
  "awaiting_approval",
  "executing",
  "verifying",
  "done",
  "failed",
  "cancelled",
];

function at(state: ErrandState): WorkflowSubject {
  return { state, transitions: [startingTransition(0)] };
}

describe("the errand workflow", () => {
  it("walks gathering → searching → choosing and keeps each step", () => {
    const searching = transitionTo(at("gathering"), "searching", "search_started", 10);
    if (searching.kind !== "transitioned") throw new Error("refused");
    const choosing = transitionTo(searching.subject, "choosing", "options_found", 20);
    if (choosing.kind !== "transitioned") throw new Error("refused");
    expect(choosing.subject.state).toBe("choosing");
    expect(choosing.subject.transitions.map(({ from, to, sequence }) => ({ from, to, sequence }))).toEqual([
      { from: undefined, to: "gathering", sequence: 0 },
      { from: "gathering", to: "searching", sequence: 1 },
      { from: "searching", to: "choosing", sequence: 2 },
    ]);
  });

  it.each([
    ["gathering", "choosing"],
    ["gathering", "awaiting_approval"],
    ["gathering", "done"],
    ["searching", "executing"],
    ["choosing", "executing"],
    ["choosing", "done"],
    ["holding", "executing"],
    ["done", "gathering"],
    ["failed", "searching"],
    ["cancelled", "gathering"],
  ] as const)("refuses %s → %s as a typed outcome and leaves the errand alone", (from, to) => {
    const subject = at(from);
    expect(transitionTo(subject, to, "search_started", 5)).toEqual({ kind: "illegal_transition", from, to });
    expect(subject).toEqual(at(from));
  });

  it("no state can move to itself", () => {
    for (const state of STATES) expect(canTransition(state, state)).toBe(false);
  });

  it("a failed run can fail the errand from every state that isn't finished", () => {
    const unfinished = STATES.filter((state) => !isFinished(state));
    expect(unfinished.filter((state) => canTransition(state, "failed"))).toEqual(unfinished);
  });

  it("done, failed and cancelled are final", () => {
    expect(STATES.filter(isFinished)).toEqual(["done", "failed", "cancelled"]);
  });

  it("every state but the start can be reached, and every unfinished state can reach a final one", () => {
    const reachable = new Set<ErrandState>(["gathering"]);
    for (let round = 0; round < STATES.length; round += 1) {
      for (const from of [...reachable]) for (const to of STATES) if (canTransition(from, to)) reachable.add(to);
    }
    expect([...reachable].sort()).toEqual([...STATES].sort());
  });

  it("a transition becomes a state_transition trace event in the tool call it happened in", () => {
    const moved = transitionTo(at("gathering"), "searching", "search_started", 1_234);
    if (moved.kind !== "transitioned") throw new Error("refused");
    expect(transitionEvent("errand_s1", moved.transition, { traceId: "s1", sessionId: "s1", spanId: "tool:s1:c1" })).toEqual({
      type: "event",
      traceId: "s1",
      eventId: "errand_s1:transition:1",
      sessionId: "s1",
      spanId: "tool:s1:c1",
      kind: "state_transition",
      name: "gathering → searching",
      timeMs: 1_234,
      attributes: {
        "errand.id": "errand_s1",
        "errand.state.from": "gathering",
        "errand.state.to": "searching",
        "errand.transition.reason": "search_started",
        "errand.transition.sequence": 1,
      },
    });
  });
});
