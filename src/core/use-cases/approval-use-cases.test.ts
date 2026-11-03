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
    if (grant === undefined || grant.consumedAtMs !== undefined) return false;
    this.grants.set(grant.proposalId, { ...grant, consumedAtMs: atMs });
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

/** A world with one provider, whose hold price and book reply each test can set. */
class FakeWorld implements Partial<ProviderWorld> {
  holdPriceInr = 499;
  holdLifetimeMs = HOLD_LIFETIME_MS;
  bookReply: "booked" | "slot_taken" | "timeout_after_success" | "timeout_without_booking" = "booked";
  readonly holds = new Map<string, Hold & { released: boolean }>();
  readonly bookings: { bookingId: string; holdId: string; key: string }[] = [];
  readonly bookCalls: string[] = [];
  readonly #keys = new Map<string, BookingStatusOutcome>();
  readonly #clock: Clock;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  async getProvider(providerId: string) {
    return providerId === PROVIDER.id ? { kind: "found" as const, provider: PROVIDER } : { kind: "provider_not_found" as const };
  }
  async holdSlot(providerId: string, slot: Slot) {
    if (providerId !== PROVIDER.id) return { kind: "provider_not_found" as const };
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
  async book(holdId: string, key: string): Promise<BookOutcome> {
    this.bookCalls.push(key);
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
