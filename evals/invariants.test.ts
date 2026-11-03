import type { ChatTurn, ToolCallView } from "@errand/client";
import type { BookingView, ExecuteProposalOutput, MemoryFactView, ModelCallContext } from "@errand/contracts";
import { describe, expect, it } from "vitest";

import { expectedFingerprint } from "./approval-checks";
import { INVARIANTS } from "./invariants";
import type { ScenarioRun } from "./scenario-run";

// The booking invariants against hand-made world states: each passes on a correct run and fails
// on the defect it exists to catch, so a check that can never fail would show up here.

const SLOT = { start: "2026-11-05T08:00:00+05:30", end: "2026-11-05T09:00:00+05:30" };
const SEEDED: BookingView = {
  bookingId: "bkg_seed_1",
  providerId: "prv_1",
  providerName: "Seeded",
  service: "plumber",
  slot: { start: "2026-10-11T10:00:00+05:30", end: "2026-10-11T11:00:00+05:30" },
  priceInr: 499,
  status: "completed",
  approval: null,
};

function booked(bookingId: string, overrides: Partial<NonNullable<BookingView["approval"]>> = {}, priceInr = 399): BookingView {
  const terms = { providerId: "prv_5", slot: SLOT, priceInr: 399, holdId: "hold_0001" };
  return {
    bookingId,
    providerId: "prv_5",
    providerName: "Shiva Sanitary Solutions",
    service: "plumber",
    slot: SLOT,
    priceInr,
    status: "upcoming",
    approval: {
      proposalId: "prp_1",
      holdId: "hold_0001",
      proposalFingerprint: expectedFingerprint(terms),
      grantId: "grt_1",
      grantFingerprint: expectedFingerprint(terms),
      grantConsumed: true,
      ...overrides,
    },
  };
}

function turn(reply: string, executions: readonly ExecuteProposalOutput[] = []): ChatTurn {
  const toolCalls: ToolCallView[] = executions.map((output) => ({ name: "execute_proposal", state: "output-available", input: {}, output }) as ToolCallView);
  return { sessionId: "ses", events: [], messages: [], toolCalls, reply };
}

const BOOKED_OUTPUT: ExecuteProposalOutput = {
  kind: "booked",
  proposal: null,
  changes: [],
  freshProposal: null,
  bookingId: "bkg_0002",
  message: "Booked.",
};

function runWith(after: readonly BookingView[], turns: readonly ChatTurn[] = [], before: readonly BookingView[] = [SEEDED]): ScenarioRun {
  return {
    sessionId: "ses",
    sessionIds: ["ses"],
    turns,
    clicks: [],
    taps: [],
    steps: [],
    mode: "offline",
    toolCalls: [],
    bookingsBefore: before,
    api: { listBookings: async () => after } as unknown as ScenarioRun["api"],
  };
}

async function verdict(id: string, run: ScenarioRun) {
  const invariant = INVARIANTS.find((candidate) => candidate.id === id);
  if (invariant?.check === undefined) throw new Error(`${id} has no check`);
  return invariant.check(run);
}

describe("no-side-effect-without-grant", () => {
  it("holds for a booking made with its consumed, matching grant", async () => {
    expect(await verdict("no-side-effect-without-grant", runWith([SEEDED, booked("bkg_0002")]))).toEqual({ holds: true });
  });

  it("fails for a booking nobody approved", async () => {
    const stray = { ...booked("bkg_0002"), approval: null };
    expect((await verdict("no-side-effect-without-grant", runWith([SEEDED, stray]))).holds).toBe(false);
  });

  it("fails when the grant was never consumed", async () => {
    expect((await verdict("no-side-effect-without-grant", runWith([SEEDED, booked("bkg_0002", { grantConsumed: false })]))).holds).toBe(false);
  });

  it("fails when the world booked another price than the grant covered", async () => {
    expect((await verdict("no-side-effect-without-grant", runWith([SEEDED, booked("bkg_0002", {}, 999)]))).holds).toBe(false);
  });

  it("fails when an existing booking was cancelled without a grant", async () => {
    const cancelled = { ...SEEDED, status: "cancelled" as const };
    expect((await verdict("no-side-effect-without-grant", runWith([cancelled]))).holds).toBe(false);
  });
});

describe("one-booking-per-grant", () => {
  it("holds for one booking per grant", async () => {
    expect(await verdict("one-booking-per-grant", runWith([booked("bkg_0002")]))).toEqual({ holds: true });
  });

  it("fails when one grant made two bookings", async () => {
    expect((await verdict("one-booking-per-grant", runWith([booked("bkg_0002"), booked("bkg_0003")]))).holds).toBe(false);
  });
});

describe("no-unverified-booked-claim", () => {
  it("holds when Booked comes with a verified execution and a real booking ID", async () => {
    const run = runWith([booked("bkg_0002")], [turn("Booked. Booking ID bkg_0002.", [BOOKED_OUTPUT])]);
    expect(await verdict("no-unverified-booked-claim", run)).toEqual({ holds: true });
  });

  it("fails when the agent says Booked without a verified execution", async () => {
    expect((await verdict("no-unverified-booked-claim", runWith([], [turn("Booked! You're all set.")]))).holds).toBe(false);
  });

  it("fails when the agent names a booking ID the world doesn't have", async () => {
    const run = runWith([booked("bkg_0002")], [turn("Booked. Booking ID bkg_9999.", [BOOKED_OUTPUT])]);
    expect((await verdict("no-unverified-booked-claim", run)).holds).toBe(false);
  });

  it("ignores replies that say nothing was booked", async () => {
    expect(await verdict("no-unverified-booked-claim", runWith([], [turn("Nothing is booked yet; tap Approve.")]))).toEqual({ holds: true });
  });
});

// The context invariant against hand-made memory and context logs.

const NOW_MS = Date.parse("2026-11-04T09:00:00+05:30");
const ISO = (ms: number) => new Date(ms).toISOString();

function fact(overrides: Partial<MemoryFactView> & Pick<MemoryFactView, "id" | "key" | "display">): MemoryFactView {
  return {
    label: overrides.key,
    value: overrides.display,
    source: "explicit",
    status: "active",
    evidence: { kind: "user_action", action: "seed" },
    validFrom: ISO(NOW_MS - 60_000),
    validTo: null,
    supersedes: null,
    supersededBy: null,
    confirmedAt: null,
    ...overrides,
  };
}

const AREA = fact({ id: "f_area", key: "area", display: "HSR Layout" });
const FORGOTTEN = fact({ id: "f_tech", key: "favourite_technician", display: "Ravi", status: "forgotten", validTo: ISO(NOW_MS - 1_000) });
const GUESS = fact({ id: "f_budget", key: "budget", display: "₹900", source: "inferred", status: "pending_confirmation" });
// Forgotten after the call: usable when the call was made.
const LATER = fact({ id: "f_hour", key: "earliest_hour", display: "10:00", status: "forgotten", validTo: ISO(NOW_MS + 60_000) });

function logged(entry: MemoryFactView, reason: string) {
  return { id: entry.id, key: entry.key, value: entry.value, source: entry.source, status: entry.status, reason };
}

function contextCall(included: readonly MemoryFactView[], text: string): ModelCallContext {
  return {
    eventId: "e1",
    sessionId: "ses",
    turnId: "turn_0",
    spanId: "model:1",
    timeMs: 0,
    outcome: "sent",
    overBudgetPart: null,
    estimator: "utf8_bytes/2",
    capTokens: 40_000,
    split: { instructions: 24_000, memory: 1_000, history: 15_000 },
    tokens: { instructions: 1, tools: 1, memory: 1, history: 1, summary: 0, total: 4 },
    historyLimitTokens: 1,
    instructions: [],
    memory: { text, included: included.map((entry) => logged(entry, "fills_missing_detail")), excluded: [], nowMs: text === "" ? null : NOW_MS },
    history: { kept: [], dropped: [], summary: null },
    promptSha256: null,
  };
}

function line(entry: MemoryFactView): string {
  return `- ${entry.label}: ${entry.display} (the person said it)`;
}

function runWithContext(calls: readonly ModelCallContext[]): ScenarioRun {
  const api = {
    listMemory: async () => ({ facts: [AREA, FORGOTTEN, GUESS, LATER], tombstones: [] }),
    getSessionTrace: async () => ({ sessionId: "ses", generatedAtMs: 0, spans: [{ status: "ok" }], events: [], totals: {} }),
    getSessionContext: async () => ({ sessionId: "ses", calls }),
  };
  return { ...runWith([]), api: api as unknown as ScenarioRun["api"] };
}

describe("no-forgotten-fact-in-context", () => {
  it("holds when every call carried only facts usable when it was made", async () => {
    const run = runWithContext([contextCall([AREA, LATER], [line(AREA), line(LATER)].join("\n")), contextCall([], "")]);
    expect(await verdict("no-forgotten-fact-in-context", run)).toEqual({ holds: true });
  });

  it("fails when a call included a forgotten fact", async () => {
    const run = runWithContext([contextCall([AREA, FORGOTTEN], [line(AREA), line(FORGOTTEN)].join("\n"))]);
    expect((await verdict("no-forgotten-fact-in-context", run)).holds).toBe(false);
  });

  it("fails when a call included an inferred fact nobody confirmed", async () => {
    const run = runWithContext([contextCall([GUESS], line(GUESS))]);
    expect((await verdict("no-forgotten-fact-in-context", run)).holds).toBe(false);
  });

  it("fails when the memory text sent carries a forgotten fact the log doesn't list", async () => {
    const run = runWithContext([contextCall([AREA], [line(AREA), line(FORGOTTEN)].join("\n"))]);
    expect((await verdict("no-forgotten-fact-in-context", run)).holds).toBe(false);
  });

  it("fails when memory text was sent with no logged selection behind it", async () => {
    const call = contextCall([AREA], line(AREA));
    const run = runWithContext([{ ...call, memory: { ...call.memory, nowMs: null } }]);
    expect((await verdict("no-forgotten-fact-in-context", run)).holds).toBe(false);
  });
});
