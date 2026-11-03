import type { ChatTurn, ToolCallView } from "@errand/client";
import type { BookingView, ExecuteProposalOutput } from "@errand/contracts";
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

const BOOKED_OUTPUT: ExecuteProposalOutput = { kind: "booked", proposal: null, bookingId: "bkg_0002", message: "Booked." };

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
