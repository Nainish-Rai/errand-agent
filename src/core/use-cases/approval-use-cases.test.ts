import { describe, expect, it } from "vitest";

import { fingerprintOf, type FingerprintedTerms } from "../approval/fingerprint";
import { GRANT_LIFETIME_MS, type Grant } from "../approval/grant";
import type { Proposal } from "../approval/proposal";
import { openErrand, type Errand } from "../errand/errand";
import { transitionTo, type ErrandState } from "../errand/errand-workflow";
import type { Clock } from "../ports/clock";
import type { ErrandChange, ErrandStore } from "../ports/errand-store";
import type { Hasher } from "../ports/hasher";
import type { ProposalQuery, ProposalStore } from "../ports/proposal-store";
import type {
  BookingStatusOutcome,
  BookOutcome,
  GetHoldOutcome,
  Hold,
  ProviderDetails,
  ProviderWorld,
  Slot,
} from "../ports/provider-world";
import type { ServiceCatalog } from "../ports/service-catalog";
import type { TraceRecord, TraceSink } from "../ports/trace-sink";
import { approveProposal } from "./approve-proposal";
import { declineProposal } from "./decline-proposal";
import { executeProposal } from "./execute-proposal";
import { holdSlot } from "./hold-slot";
import { listBookings } from "./list-bookings";
import type { ProposalDependencies } from "./proposal-session";
import { proposeBooking } from "./propose-booking";

// The approval guarantee, driven through the use cases with in-memory ports: a proposal is made
// from the world's hold, only an approval of its exact fingerprint mints a grant, the grant is
// used once and never outlives the hold, and execute books nothing without it.

const SESSION = "ses_1";
const USER = "dev-user";
const PLACE = { traceId: SESSION, sessionId: SESSION };
const START_MS = Date.parse("2026-11-04T03:30:00Z");
const SLOT: Slot = { start: "2026-11-05T09:00:00+05:30", end: "2026-11-05T10:00:00+05:30" };
const HOLD_LIFETIME_MS = 10 * 60 * 1_000;

class StepClock implements Clock {
  ms = START_MS;
  now() {
    return new Date(this.ms);
  }
}

/** Not a real digest; core only needs equal text to give equal output and different text different output. */
const hasher: Hasher = { sha256Hex: (text) => [...text].map((c) => c.charCodeAt(0).toString(16)).join("") };

class MemoryErrands implements ErrandStore {
  readonly errands = new Map<string, Errand>();
  async find(sessionId: string) {
    return this.errands.get(sessionId);
  }
  async change<T>(sessionId: string, change: (current: Errand | undefined) => Promise<ErrandChange<T>>) {
    const { errand, result } = await change(this.errands.get(sessionId));
    if (errand !== undefined) this.errands.set(sessionId, errand);
    return result;
  }
}

class MemorySink implements TraceSink {
  readonly records: TraceRecord[] = [];
  async record(record: TraceRecord) {
    this.records.push(record);
  }
  async read() {
    return this.records;
  }
}

class MemoryProposals implements ProposalStore {
  readonly proposals = new Map<string, Proposal>();
  readonly grants = new Map<string, Grant>();
  async saveProposal(proposal: Proposal) {
    this.proposals.set(proposal.proposalId, proposal);
  }
  async findProposal(id: string) {
    return this.proposals.get(id);
  }
  async latestProposalOf(sessionId: string) {
    return [...this.proposals.values()].filter((p) => p.sessionId === sessionId).at(-1);
  }
  async findProposalByBooking(bookingId: string) {
    return [...this.proposals.values()].find((p) => p.bookingId === bookingId);
  }
  async listProposals(query: ProposalQuery) {
    return [...this.proposals.values()].filter((p) => p.userId === query.userId).reverse();
  }
  async issueGrant(grant: Grant) {
    const existing = this.grants.get(grant.proposalId);
    if (existing !== undefined) return existing;
    this.grants.set(grant.proposalId, grant);
    return grant;
  }
  async grantOf(proposalId: string) {
    return this.grants.get(proposalId);
  }
  async consumeGrant(grantId: string, atMs: number) {
    const grant = [...this.grants.values()].find((g) => g.grantId === grantId);
    if (grant === undefined || grant.consumedAtMs !== undefined || grant.voidedAtMs !== undefined) return false;
    this.grants.set(grant.proposalId, { ...grant, consumedAtMs: atMs });
    return true;
  }
  async voidGrant(grantId: string, atMs: number) {
    const grant = [...this.grants.values()].find((g) => g.grantId === grantId);
    if (grant === undefined || grant.consumedAtMs !== undefined || grant.voidedAtMs !== undefined) return false;
    this.grants.set(grant.proposalId, { ...grant, voidedAtMs: atMs });
    return true;
  }
  async discardAll() {
    this.proposals.clear();
    this.grants.clear();
  }
}

const PROVIDER: ProviderDetails = {
  id: "prv_1",
  name: "Ravi Plumbing",
  service: "plumber",
  area: "Koramangala",
  priceInr: 499,
  rating: 4.6,
  reviewCount: 80,
  freeSlots: [SLOT],
  attributes: [],
  about: "",
  cancellationTerms: "Free until 2 hours before the visit.",
  reviews: [],
};

const OTHER_PROVIDER: ProviderDetails = { ...PROVIDER, id: "prv_2", name: "Kumar Pipes", priceInr: 549 };

/** A world with one provider, whose hold price and book reply each test can set. */
class FakeWorld implements Partial<ProviderWorld> {
  holdPriceInr = 499;
  holdLifetimeMs = HOLD_LIFETIME_MS;
  bookReply: "booked" | "slot_taken" | "timeout_after_success" | "timeout_without_booking" = "booked";
  /** Applied to the hold the next time it is re-read: the provider changing held terms. */
  reviseHold: ((hold: Hold) => Hold) | undefined;
  /** The next book call finds its hold lapsed. */
  lapseHoldOnBook = false;
  /** holdSlot refuses: someone else took the slot. */
  slotGone = false;
  readonly getHoldCalls: string[] = [];
  readonly holds = new Map<string, Hold & { released: boolean }>();
  readonly bookings: { bookingId: string; holdId: string; key: string }[] = [];
  readonly bookCalls: string[] = [];
  readonly #keys = new Map<string, BookingStatusOutcome>();
  readonly #clock: Clock;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  async getProvider(providerId: string) {
    const provider = [PROVIDER, OTHER_PROVIDER].find((candidate) => candidate.id === providerId);
    return provider === undefined ? { kind: "provider_not_found" as const } : { kind: "found" as const, provider };
  }
  async holdSlot(providerId: string, slot: Slot) {
    if (providerId !== PROVIDER.id && providerId !== OTHER_PROVIDER.id) return { kind: "provider_not_found" as const };
    if (this.slotGone) return { kind: "slot_unavailable" as const };
    const hold = {
      holdId: `hold_${this.holds.size + 1}`,
      providerId,
      slot,
      quotedPriceInr: this.holdPriceInr,
      expiresAt: new Date(this.#clock.now().getTime() + this.holdLifetimeMs).toISOString(),
      released: false,
    };
    this.holds.set(hold.holdId, hold);
    return { kind: "held" as const, hold };
  }
  async releaseHold(holdId: string) {
    const hold = this.holds.get(holdId);
    if (hold === undefined || hold.released) return { kind: "hold_not_found" as const };
    hold.released = true;
    return { kind: "released" as const };
  }
  async getHold(holdId: string): Promise<GetHoldOutcome> {
    this.getHoldCalls.push(holdId);
    const stored = this.holds.get(holdId);
    if (stored === undefined || stored.released) return { kind: "hold_not_found" };
    const hold = this.reviseHold === undefined ? stored : { ...this.reviseHold(stored), released: false };
    this.reviseHold = undefined;
    this.holds.set(holdId, hold);
    const { released: _released, ...visible } = hold;
    return this.#clock.now().getTime() > Date.parse(hold.expiresAt) ? { kind: "hold_expired", hold: visible } : { kind: "held", hold: visible };
  }
  async book(holdId: string, key: string): Promise<BookOutcome> {
    this.bookCalls.push(key);
    if (this.lapseHoldOnBook) {
      this.lapseHoldOnBook = false;
      return { kind: "hold_expired" };
    }
    const recorded = this.#keys.get(key);
    if (recorded?.kind === "booked") return recorded;
    if (this.holds.get(holdId)?.released !== false) return { kind: "hold_not_found" };
    if (this.bookReply === "slot_taken") {
      this.#keys.set(key, { kind: "failed", reason: "slot_taken" });
      return { kind: "slot_taken" };
    }
    if (this.bookReply === "timeout_without_booking") return { kind: "timeout" };
    const bookingId = `bkg_${this.bookings.length + 1}`;
    this.bookings.push({ bookingId, holdId, key });
    this.#keys.set(key, { kind: "booked", bookingId });
    return this.bookReply === "timeout_after_success" ? { kind: "timeout" } : { kind: "booked", bookingId };
  }
  async getBookingStatus(key: string): Promise<BookingStatusOutcome> {
    return this.#keys.get(key) ?? { kind: "not_found" };
  }
  async listBookings() {
    return this.bookings.map(({ bookingId }) => ({
      bookingId,
      userId: USER,
      providerId: PROVIDER.id,
      providerName: PROVIDER.name,
      service: PROVIDER.service,
      slot: SLOT,
      priceInr: this.holdPriceInr,
      status: "upcoming" as const,
    }));
  }
}

const catalog: ServiceCatalog = {
  services: () => ["plumber"],
  areas: () => ["Koramangala"],
  resolveService: () => "plumber",
  resolveArea: () => "Koramangala",
};

function choosingErrand(atMs: number): Errand {
  let errand: Errand = {
    ...openErrand(SESSION, atMs),
    details: { service: "plumber", area: "Koramangala", timeWindow: { dates: { from: "2026-11-04", to: "2026-11-10" } }, preferences: [] },
  };
  for (const to of ["searching", "choosing"] as ErrandState[]) {
    const next = transitionTo(errand, to, "search_started", atMs);
    if (next.kind !== "transitioned") throw new Error("setup");
    errand = next.subject;
  }
  return errand;
}

function setUp() {
  const clock = new StepClock();
  const errands = new MemoryErrands();
  errands.errands.set(SESSION, choosingErrand(clock.ms));
  const world = new FakeWorld(clock);
  const proposals = new MemoryProposals();
  let id = 0;
  const deps: ProposalDependencies = {
    errand: { errands, catalog, traceSink: new MemorySink(), clock },
    world: world as unknown as ProviderWorld,
    proposals,
    hasher,
    ids: { next: (prefix) => `${prefix}_${(id += 1)}` },
    worldClock: clock,
  };
  return { clock, errands, world, proposals, deps };
}

type Setup = ReturnType<typeof setUp>;

async function proposedBooking(setup: Setup): Promise<Proposal> {
  const held = await holdSlot(setup.deps, { place: PLACE, providerId: PROVIDER.id, slot: SLOT });
  if (held.kind !== "held") throw new Error(`hold: ${held.kind}`);
  const proposed = await proposeBooking(setup.deps, { place: PLACE, userId: USER });
  if (proposed.kind !== "proposed") throw new Error(`propose: ${proposed.kind}`);
  return proposed.proposal;
}

function click(proposal: Proposal, fingerprint = proposal.fingerprint) {
  return { proposalId: proposal.proposalId, fingerprint, userId: USER };
}

async function errandState(setup: Setup) {
  return (await setup.errands.find(SESSION))?.state;
}

describe("fingerprint", () => {
  const terms: FingerprintedTerms = { action: "book", providerId: "prv_1", slot: SLOT, priceInr: 499, holdId: "hold_1" };

  it("changes when the provider, slot, price or hold changes", () => {
    const base = fingerprintOf(terms, hasher);
    const changes: FingerprintedTerms[] = [
      { ...terms, providerId: "prv_2" },
      { ...terms, slot: { ...SLOT, start: "2026-11-05T10:00:00+05:30" } },
      { ...terms, slot: { ...SLOT, end: "2026-11-05T11:00:00+05:30" } },
      { ...terms, priceInr: 500 },
      { ...terms, holdId: "hold_2" },
    ];
    for (const changed of changes) expect(fingerprintOf(changed, hasher)).not.toBe(base);
    expect(fingerprintOf({ ...terms }, hasher)).toBe(base);
  });
});

describe("propose a booking", () => {
  it("snapshots the world's held quote, not what the search or the model said", async () => {
    const setup = setUp();
    setup.world.holdPriceInr = 599;
    const proposal = await proposedBooking(setup);
    expect(proposal.terms).toMatchObject({
      providerId: PROVIDER.id,
      providerName: PROVIDER.name,
      slot: SLOT,
      priceInr: 599,
      holdId: "hold_1",
      area: "Koramangala",
      cancellationTerms: PROVIDER.cancellationTerms,
    });
    expect(proposal.fingerprint).toBe(fingerprintOf(proposal.terms, hasher));
    expect(proposal.status).toBe("pending");
    expect(await errandState(setup)).toBe("awaiting_approval");
  });

  it("shows the same proposal again when asked twice, instead of making a second one", async () => {
    const setup = setUp();
    const first = await proposedBooking(setup);
    const again = await proposeBooking(setup.deps, { place: PLACE, userId: USER });
    expect(again).toEqual({ kind: "proposed", proposal: first });
    expect(setup.proposals.proposals.size).toBe(1);
  });
});

describe("a grant", () => {
  it("can't be created from model output: without a click, execute books nothing and no grant exists", async () => {
    const setup = setUp();
    const proposal = await proposedBooking(setup);
    const outcome = await executeProposal(setup.deps, { place: PLACE });
    expect(outcome).toEqual({ kind: "not_approved", proposal });
    expect(setup.proposals.grants.size).toBe(0);
    expect(setup.world.bookCalls).toEqual([]);
    expect(await errandState(setup)).toBe("awaiting_approval");
  });

  it("can't be created for terms the model made up: a fingerprint of other terms is refused", async () => {
    const setup = setUp();
    const proposal = await proposedBooking(setup);
    const claimed = fingerprintOf({ ...proposal.terms, priceInr: 1 }, hasher);
    expect((await approveProposal(setup.deps, click(proposal, claimed))).kind).toBe("fingerprint_mismatch");
    expect(setup.proposals.grants.size).toBe(0);
  });

  it("is minted once: approving twice returns the same grant", async () => {
    const setup = setUp();
    const proposal = await proposedBooking(setup);
    const first = await approveProposal(setup.deps, click(proposal));
    const second = await approveProposal(setup.deps, click(proposal));
    if (first.kind !== "approved" || second.kind !== "approved") throw new Error("expected approvals");
    expect(second.grant).toEqual(first.grant);
    expect(setup.proposals.grants.size).toBe(1);
  });

  it("is only the proposal's own person's to mint", async () => {
    const setup = setUp();
    const proposal = await proposedBooking(setup);
    const stranger = { ...click(proposal), userId: "someone-else" };
    expect(await approveProposal(setup.deps, stranger)).toEqual({ kind: "proposal_not_found" });
    expect(setup.proposals.grants.size).toBe(0);
  });

  it("expires no later than the hold", async () => {
    const short = setUp();
    short.world.holdLifetimeMs = 2 * 60 * 1_000;
    const shortProposal = await proposedBooking(short);
    const shortGrant = await approveProposal(short.deps, click(shortProposal));
    if (shortGrant.kind !== "approved") throw new Error(shortGrant.kind);
    expect(shortGrant.grant.expiresAtMs).toBe(Date.parse(shortProposal.terms.holdExpiresAt));

    const long = setUp();
    const longProposal = await proposedBooking(long);
    const longGrant = await approveProposal(long.deps, click(longProposal));
    if (longGrant.kind !== "approved") throw new Error(longGrant.kind);
    expect(longGrant.grant.expiresAtMs).toBe(START_MS + GRANT_LIFETIME_MS);
    expect(longGrant.grant.expiresAtMs).toBeLessThanOrEqual(Date.parse(longProposal.terms.holdExpiresAt));
  });

  it("that has expired books nothing", async () => {
    const setup = setUp();
    const proposal = await proposedBooking(setup);
    await approveProposal(setup.deps, click(proposal));
    setup.clock.ms += GRANT_LIFETIME_MS + 1;
    const outcome = await executeProposal(setup.deps, { place: PLACE });
    expect(outcome.kind).toBe("approval_expired");
    expect(setup.world.bookCalls).toEqual([]);
    expect(await errandState(setup)).toBe("choosing");
  });

  it("can't be minted once the hold has run out", async () => {
    const setup = setUp();
    const proposal = await proposedBooking(setup);
    setup.clock.ms += HOLD_LIFETIME_MS + 1;
    expect((await approveProposal(setup.deps, click(proposal))).kind).toBe("hold_expired");
    expect(setup.proposals.grants.size).toBe(0);
  });

  it("is single-use: it books once, and executing again books nothing new", async () => {
    const setup = setUp();
    const proposal = await proposedBooking(setup);
    const approved = await approveProposal(setup.deps, click(proposal));
    if (approved.kind !== "approved") throw new Error(approved.kind);

    const first = await executeProposal(setup.deps, { place: PLACE });
    const second = await executeProposal(setup.deps, { place: PLACE });
    expect(first).toMatchObject({ kind: "booked", bookingId: "bkg_1" });
    expect(second).toMatchObject({ kind: "already_booked", bookingId: "bkg_1" });
    expect(setup.world.bookings).toHaveLength(1);
    expect(setup.world.bookCalls).toEqual([`book:${approved.grant.grantId}`]);
    expect(await setup.deps.proposals.consumeGrant(approved.grant.grantId, setup.clock.ms)).toBe(false);
    expect(setup.proposals.grants.get(proposal.proposalId)?.consumedAtMs).toBe(START_MS);
  });
});

describe("execute a proposal", () => {
  async function approvedSetup(reply: FakeWorld["bookReply"]) {
    const setup = setUp();
    setup.world.bookReply = reply;
    const proposal = await proposedBooking(setup);
    await approveProposal(setup.deps, click(proposal));
    return setup;
  }

  it("reports booked only with the booking ID the status confirmed, and the errand is done", async () => {
    const setup = await approvedSetup("booked");
    const outcome = await executeProposal(setup.deps, { place: PLACE });
    expect(outcome).toMatchObject({ kind: "booked", bookingId: "bkg_1", proposal: { status: "executed", bookingId: "bkg_1" } });
    expect(await errandState(setup)).toBe("done");
    const [listed] = await listBookings(setup.deps, USER);
    expect(listed?.approval?.proposal.proposalId).toBe(outcome.kind === "booked" ? outcome.proposal.proposalId : "");
    expect(listed?.approval?.grant?.consumedAtMs).toBeDefined();
  });

  it("checks the status after a timeout, and finds the booking that was made", async () => {
    const setup = await approvedSetup("timeout_after_success");
    expect(await executeProposal(setup.deps, { place: PLACE })).toMatchObject({ kind: "booked", bookingId: "bkg_1" });
  });

  it("says verifying, never booked or failed, when the status can't confirm a timed-out booking", async () => {
    const setup = await approvedSetup("timeout_without_booking");
    expect((await executeProposal(setup.deps, { place: PLACE })).kind).toBe("verifying");
    expect(await errandState(setup)).toBe("verifying");
  });

  it("reports a lost slot as slot_taken", async () => {
    const setup = await approvedSetup("slot_taken");
    expect((await executeProposal(setup.deps, { place: PLACE })).kind).toBe("slot_taken");
    expect(await errandState(setup)).toBe("failed");
  });
});

describe("decline a proposal", () => {
  it("books nothing, releases the hold and returns the errand to its options", async () => {
    const setup = setUp();
    const proposal = await proposedBooking(setup);
    const outcome = await declineProposal(setup.deps, { proposalId: proposal.proposalId, userId: USER });
    expect(outcome).toMatchObject({ kind: "declined", proposal: { status: "declined" } });
    expect(setup.world.holds.get(proposal.terms.holdId)?.released).toBe(true);
    expect(await errandState(setup)).toBe("choosing");
    expect((await setup.errands.find(SESSION))?.hold).toBeUndefined();

    expect((await approveProposal(setup.deps, click(proposal))).kind).toBe("not_pending");
    expect((await executeProposal(setup.deps, { place: PLACE })).kind).toBe("declined");
    expect(setup.world.bookCalls).toEqual([]);
  });

  it("refuses an approved proposal's grant once declined", async () => {
    const setup = setUp();
    const proposal = await proposedBooking(setup);
    await approveProposal(setup.deps, click(proposal));
    await declineProposal(setup.deps, { proposalId: proposal.proposalId, userId: USER });
    expect((await executeProposal(setup.deps, { place: PLACE })).kind).toBe("declined");
    expect(setup.world.bookCalls).toEqual([]);
  });

  it("is too late once the booking was made", async () => {
    const setup = setUp();
    const proposal = await proposedBooking(setup);
    await approveProposal(setup.deps, click(proposal));
    await executeProposal(setup.deps, { place: PLACE });
    expect((await declineProposal(setup.deps, { proposalId: proposal.proposalId, userId: USER })).kind).toBe("too_late");
  });
});

describe("approval invalidation: core re-reads the live hold before the grant is used", () => {
  async function approved(setup: Setup) {
    const proposal = await proposedBooking(setup);
    const outcome = await approveProposal(setup.deps, click(proposal));
    if (outcome.kind !== "approved") throw new Error(outcome.kind);
    return { proposal, grant: outcome.grant };
  }

  const LATER_SLOT: Slot = { start: "2026-11-05T11:00:00+05:30", end: "2026-11-05T12:00:00+05:30" };

  it("books when the live hold still has exactly the approved terms", async () => {
    const setup = setUp();
    const { proposal } = await approved(setup);
    expect((await executeProposal(setup.deps, { place: PLACE })).kind).toBe("booked");
    expect(setup.world.getHoldCalls).toEqual([proposal.terms.holdId]);
  });

  it("a changed price voids the grant, books nothing and proposes the live price", async () => {
    const setup = setUp();
    const { proposal, grant } = await approved(setup);
    setup.world.reviseHold = (hold) => ({ ...hold, quotedPriceInr: 599 });

    const outcome = await executeProposal(setup.deps, { place: PLACE });
    if (outcome.kind !== "approval_invalidated") throw new Error(outcome.kind);
    expect(outcome.changes).toEqual([{ field: "price", from: 499, to: 599 }]);
    expect(setup.world.bookCalls).toEqual([]);
    expect(setup.proposals.grants.get(proposal.proposalId)).toMatchObject({ voidedAtMs: START_MS });
    expect(setup.proposals.grants.get(proposal.proposalId)?.consumedAtMs).toBeUndefined();
    expect(await setup.deps.proposals.consumeGrant(grant.grantId, START_MS)).toBe(false);

    const old = await setup.deps.proposals.findProposal(proposal.proposalId);
    expect(old).toMatchObject({ status: "voided", invalidation: { replacedBy: outcome.freshProposal.proposalId } });
    expect(outcome.freshProposal).toMatchObject({ status: "pending", terms: { priceInr: 599, holdId: proposal.terms.holdId } });
    expect(outcome.freshProposal.fingerprint).not.toBe(proposal.fingerprint);
    expect((await setup.deps.proposals.latestProposalOf(SESSION))?.proposalId).toBe(outcome.freshProposal.proposalId);
    const errand = await setup.errands.find(SESSION);
    expect(errand?.state).toBe("awaiting_approval");
    expect(errand?.hold?.quotedPriceInr).toBe(599);
    expect(errand?.transitions.slice(-2).map((t) => `${t.from}→${t.to}:${t.reason}`)).toEqual([
      "awaiting_approval→holding:proposal_voided",
      "holding→awaiting_approval:proposal_shown",
    ]);
  });

  it("books only after a second approval, of the fresh proposal, and exactly once", async () => {
    const setup = setUp();
    await approved(setup);
    setup.world.reviseHold = (hold) => ({ ...hold, quotedPriceInr: 599 });
    const voided = await executeProposal(setup.deps, { place: PLACE });
    if (voided.kind !== "approval_invalidated") throw new Error(voided.kind);

    // Saying "go ahead" again without the second click books nothing.
    expect((await executeProposal(setup.deps, { place: PLACE })).kind).toBe("not_approved");
    expect(setup.world.bookCalls).toEqual([]);

    const second = await approveProposal(setup.deps, click(voided.freshProposal));
    if (second.kind !== "approved") throw new Error(second.kind);
    const booked = await executeProposal(setup.deps, { place: PLACE });
    expect(booked).toMatchObject({ kind: "booked", proposal: { proposalId: voided.freshProposal.proposalId, terms: { priceInr: 599 } } });
    expect(setup.world.bookCalls).toEqual([`book:${second.grant.grantId}`]);
    expect(setup.world.bookings).toHaveLength(1);
  });

  it("a moved slot voids the grant and proposes the live slot", async () => {
    const setup = setUp();
    await approved(setup);
    setup.world.reviseHold = (hold) => ({ ...hold, slot: LATER_SLOT });
    const outcome = await executeProposal(setup.deps, { place: PLACE });
    if (outcome.kind !== "approval_invalidated") throw new Error(outcome.kind);
    expect(outcome.changes).toEqual([{ field: "slot", from: SLOT, to: LATER_SLOT }]);
    expect(outcome.freshProposal.terms.slot).toEqual(LATER_SLOT);
    expect(setup.world.bookCalls).toEqual([]);
  });

  it("a changed provider voids the grant and names both providers", async () => {
    const setup = setUp();
    await approved(setup);
    setup.world.reviseHold = (hold) => ({ ...hold, providerId: OTHER_PROVIDER.id });
    const outcome = await executeProposal(setup.deps, { place: PLACE });
    if (outcome.kind !== "approval_invalidated") throw new Error(outcome.kind);
    expect(outcome.changes).toEqual([
      {
        field: "provider",
        from: { providerId: PROVIDER.id, providerName: PROVIDER.name },
        to: { providerId: OTHER_PROVIDER.id, providerName: OTHER_PROVIDER.name },
      },
    ]);
    expect(outcome.freshProposal.terms.providerName).toBe(OTHER_PROVIDER.name);
    expect(setup.world.bookCalls).toEqual([]);
  });

  it("lists every change when the price and the slot both moved", async () => {
    const setup = setUp();
    await approved(setup);
    setup.world.reviseHold = (hold) => ({ ...hold, slot: LATER_SLOT, quotedPriceInr: 599 });
    const outcome = await executeProposal(setup.deps, { place: PLACE });
    expect(outcome.kind === "approval_invalidated" ? outcome.changes.map((change) => change.field) : []).toEqual(["slot", "price"]);
  });

  it("refuses a second click on the voided card", async () => {
    const setup = setUp();
    const { proposal } = await approved(setup);
    setup.world.reviseHold = (hold) => ({ ...hold, quotedPriceInr: 599 });
    await executeProposal(setup.deps, { place: PLACE });
    expect(await approveProposal(setup.deps, click(proposal))).toMatchObject({ kind: "not_pending", status: "voided" });
  });

  it("won't release the hold the fresh proposal now stands on when the voided card is declined", async () => {
    const setup = setUp();
    const { proposal } = await approved(setup);
    setup.world.reviseHold = (hold) => ({ ...hold, quotedPriceInr: 599 });
    await executeProposal(setup.deps, { place: PLACE });
    expect(await declineProposal(setup.deps, { proposalId: proposal.proposalId, userId: USER })).toMatchObject({ kind: "too_late", status: "voided" });
    expect(setup.world.holds.get(proposal.terms.holdId)?.released).toBe(false);
  });

  it("an expired live hold is held again and proposed again, and nothing is booked", async () => {
    const setup = setUp();
    const { proposal } = await approved(setup);
    setup.world.reviseHold = (hold) => ({ ...hold, expiresAt: new Date(START_MS - 1).toISOString() });
    const outcome = await executeProposal(setup.deps, { place: PLACE });
    if (outcome.kind !== "hold_reproposed") throw new Error(outcome.kind);
    expect(outcome.changes).toEqual([]);
    expect(outcome.freshProposal.terms.holdId).not.toBe(proposal.terms.holdId);
    expect(outcome.proposal).toMatchObject({ status: "expired", invalidation: { replacedBy: outcome.freshProposal.proposalId } });
    expect(setup.proposals.grants.get(proposal.proposalId)?.voidedAtMs).toBe(START_MS);
    expect(setup.world.bookCalls).toEqual([]);
    expect(await errandState(setup)).toBe("awaiting_approval");
  });

  it("book returning hold_expired holds again and proposes again; only a fresh approval books", async () => {
    const setup = setUp();
    const { proposal, grant } = await approved(setup);
    setup.world.lapseHoldOnBook = true;

    const outcome = await executeProposal(setup.deps, { place: PLACE });
    if (outcome.kind !== "hold_reproposed") throw new Error(outcome.kind);
    expect(setup.world.bookings).toHaveLength(0);
    expect(setup.world.bookCalls).toEqual([`book:${grant.grantId}`]);
    expect(outcome.proposal.status).toBe("expired");
    expect(outcome.freshProposal.terms.holdId).toBe("hold_2");
    const errand = await setup.errands.find(SESSION);
    expect(errand?.state).toBe("awaiting_approval");
    expect(errand?.hold?.holdId).toBe("hold_2");
    expect(errand?.transitions.slice(-3).map((t) => `${t.from}→${t.to}:${t.reason}`)).toEqual([
      "awaiting_approval→executing:approved",
      "executing→holding:slot_held",
      "holding→awaiting_approval:proposal_shown",
    ]);

    expect((await executeProposal(setup.deps, { place: PLACE })).kind).toBe("not_approved");
    expect(setup.world.bookings).toHaveLength(0);

    const second = await approveProposal(setup.deps, click(outcome.freshProposal));
    if (second.kind !== "approved") throw new Error(second.kind);
    expect(await executeProposal(setup.deps, { place: PLACE })).toMatchObject({ kind: "booked" });
    expect(setup.world.bookings).toEqual([expect.objectContaining({ holdId: "hold_2", key: `book:${second.grant.grantId}` })]);
    expect(proposal.proposalId).not.toBe(outcome.freshProposal.proposalId);
  });

  it("an expired hold whose slot is gone books nothing and returns the errand to its options", async () => {
    const setup = setUp();
    await approved(setup);
    setup.world.lapseHoldOnBook = true;
    setup.world.slotGone = true;
    const outcome = await executeProposal(setup.deps, { place: PLACE });
    expect(outcome).toMatchObject({ kind: "hold_lost", proposal: { status: "expired" } });
    expect(setup.world.bookings).toHaveLength(0);
    expect(await errandState(setup)).toBe("choosing");
  });
});
