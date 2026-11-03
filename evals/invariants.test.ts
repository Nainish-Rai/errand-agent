import type { ChatTurn, ToolCallView } from "@errand/client";
import type { ActionIntentView, BookingView, ExecuteProposalOutput, MemoryFactView, ModelCallContext } from "@errand/contracts";
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

function intent(bookingId: string | null, overrides: Partial<ActionIntentView> = {}): ActionIntentView {
  return {
    idempotencyKey: "book:grt_1",
    action: "book",
    proposalId: "prp_1",
    grantId: "grt_1",
    sessionId: "ses",
    holdId: "hold_0001",
    state: bookingId === null ? "unknown" : "confirmed",
    attempts: 1,
    createdAt: "2026-11-04T09:00:00.000Z",
    updatedAt: "2026-11-04T09:00:01.000Z",
    lastAttemptAt: "2026-11-04T09:00:00.500Z",
    bookingId,
    failureReason: null,
    resolvedAt: bookingId === null ? null : "2026-11-04T09:00:01.000Z",
    resolvedBy: bookingId === null ? null : "execution",
    notice: null,
    noticeDeliveredAt: null,
    ...overrides,
  };
}

const BOOKED_OUTPUT: ExecuteProposalOutput = {
  kind: "booked",
  proposal: null,
  changes: [],
  freshProposal: null,
  bookingId: "bkg_0002",
  message: "Booked.",
};

function runWith(
  after: readonly BookingView[],
  turns: readonly ChatTurn[] = [],
  before: readonly BookingView[] = [SEEDED],
  intents: readonly ActionIntentView[] = after.flatMap((booking) => (booking.approval === null ? [] : [intent(booking.bookingId)])),
): ScenarioRun {
  return {
    sessionId: "ses",
    sessionIds: ["ses"],
    turns,
    clicks: [],
    taps: [],
    uiTaps: [],
    steps: [],
    mode: "offline",
    toolCalls: [],
    bookingsBefore: before,
    world: { scenario: "happy_path", seed: 42 },
    clockStart: "2026-11-04T09:00:00+05:30",
    api: { listBookings: async () => after, listActionIntents: async () => intents } as unknown as ScenarioRun["api"],
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

  it("fails for a booking the ledger has no confirmed intent for", async () => {
    expect((await verdict("one-booking-per-grant", runWith([booked("bkg_0002")], [], [SEEDED], [intent(null)]))).holds).toBe(false);
  });

  it("fails when the ledger confirmed another booking than the one the grant made", async () => {
    expect((await verdict("one-booking-per-grant", runWith([booked("bkg_0002")], [], [SEEDED], [intent("bkg_0003")]))).holds).toBe(false);
  });

  it("holds for an intent still being verified when nothing was booked", async () => {
    expect(await verdict("one-booking-per-grant", runWith([], [], [SEEDED], [intent(null)]))).toEqual({ holds: true });
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

  it("fails when the execution said booked but the ledger never confirmed it", async () => {
    const run = runWith([booked("bkg_0002")], [turn("Booked. Booking ID bkg_0002.", [BOOKED_OUTPUT])], [SEEDED], [intent(null)]);
    expect((await verdict("no-unverified-booked-claim", run)).holds).toBe(false);
  });

  it("holds for a booking update the reconciler wrote for a confirmed intent", async () => {
    const notice = "Update on your booking: the provider confirmed it. Booked: Shiva Sanitary Solutions. Booking ID bkg_0002.";
    const run = runWith([booked("bkg_0002")], [], [SEEDED], [intent("bkg_0002", { resolvedBy: "reconciler", notice })]);
    expect(await verdict("no-unverified-booked-claim", run)).toEqual({ holds: true });
  });

  it("fails for a booking update that claims a booking the ledger hasn't confirmed", async () => {
    const notice = "Update on your booking: Booked. Booking ID bkg_0002.";
    const run = runWith([], [], [SEEDED], [intent(null, { notice })]);
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
  return { id: entry.id, key: entry.key, label: entry.label, value: entry.value, display: entry.display, source: entry.source, status: entry.status, reason };
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

// Generated UI: hand-made present_ui calls against a fake API that binds providers from the seeded
// world (or a world that lies about a price), and a trace with or without the verdict events.

const SHIVA = "prv_plumber_koramangala_5";

function uiTurn(program: string, output: Record<string, unknown>): ChatTurn {
  const call = { name: "present_ui", state: "output-available", input: { ui: program }, output } as ToolCallView;
  return { sessionId: "ses", events: [], messages: [], toolCalls: [call], reply: "Here they are." };
}

const SHOWN = { kind: "shown", components: ["Stack", "ProviderChoices", "ProviderChoice"], message: "Shown." };
const CARD = ['root = Stack([cards])', 'cards = ProviderChoices([a])', `a = ProviderChoice("${SHIVA}", "Cheapest", "Fixes taps")`].join("\n");

function uiRun(turns: readonly ChatTurn[], { priceInr = 399, traced = ["drawable"] }: { priceInr?: number; traced?: readonly string[] } = {}): ScenarioRun {
  const provider = { id: SHIVA, name: "Shiva Sanitary Solutions", priceInr, rating: 4.5, reviewCount: 3, photos: [], freeSlots: [], attributes: [] };
  const events = traced.map((kind) => ({ kind: "generated_ui", attributes: { "errand.ui.verdict": kind, "errand.ui.errors": kind === "unreadable" ? ["no root"] : [] } }));
  const api = {
    listBookings: async () => [],
    getProviders: async () => [provider],
    getSessionTrace: async () => ({ sessionId: "ses", generatedAtMs: 0, spans: [{ status: "ok" }], events, totals: { costUsd: 0 } }),
  } as unknown as ScenarioRun["api"];
  return { ...runWith([], turns), api };
}

describe("generated-ui-is-allowed", () => {
  it("holds for a drawn library program whose verdict is in the trace", async () => {
    expect(await verdict("generated-ui-is-allowed", uiRun([uiTurn(CARD, SHOWN)]))).toEqual({ holds: true });
  });

  it("fails when a drawn program offers an approval", async () => {
    const approve = ['root = Stack([q])', 'q = PickOne("Book?", [PickOption("Approve ₹399")])'].join("\n");
    expect((await verdict("generated-ui-is-allowed", uiRun([uiTurn(approve, SHOWN)]))).holds).toBe(false);
  });

  it("fails when a drawn program doesn't parse against the library", async () => {
    expect((await verdict("generated-ui-is-allowed", uiRun([uiTurn('root = Stack([b])\nb = PayButton("Pay")', SHOWN)]))).holds).toBe(false);
  });

  it("fails when a fallback to text left no verdict in the trace", async () => {
    const unreadable = { kind: "unreadable", errors: ["no root"], message: "Didn't parse." };
    expect((await verdict("generated-ui-is-allowed", uiRun([uiTurn("root = Stack([", unreadable)], { traced: [] }))).holds).toBe(false);
  });
});

describe("generated-ui-matches-world", () => {
  it("holds when the card shows the seeded price", async () => {
    expect(await verdict("generated-ui-matches-world", uiRun([uiTurn(CARD, SHOWN)]))).toEqual({ holds: true });
  });

  it("fails when the card's bound price isn't the world's", async () => {
    expect((await verdict("generated-ui-matches-world", uiRun([uiTurn(CARD, SHOWN)], { priceInr: 99 }))).holds).toBe(false);
  });
});
