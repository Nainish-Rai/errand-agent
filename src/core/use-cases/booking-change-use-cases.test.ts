import { describe, expect, it } from "vitest";

import { fingerprintOf } from "../approval/fingerprint";
import type { Grant } from "../approval/grant";
import type { BookingChangeProposal, Proposal } from "../approval/proposal";
import { bookingChangeIntentFor, type ActionIntent } from "../booking/action-intent";
import { cancellationFeeOf } from "../booking/cancellation-fee";
import type { Errand } from "../errand/errand";
import type { ActionIntentQuery, ActionLedger } from "../ports/action-ledger";
import type { Clock } from "../ports/clock";
import type { ErrandChange, ErrandStore } from "../ports/errand-store";
import type { Hasher } from "../ports/hasher";
import type { ProposalQuery, ProposalStore } from "../ports/proposal-store";
import type {
  Booking,
  CancellationPolicy,
  CancelOutcome,
  ProviderDetails,
  ProviderWorld,
  RescheduleOutcome,
  SearchOutcome,
  Slot,
} from "../ports/provider-world";
import type { TraceRecord, TraceSink } from "../ports/trace-sink";
import { approveProposal } from "./approve-proposal";
import type { BookingDependencies } from "./book-approved-proposal";
import { declineProposal } from "./decline-proposal";
import { executeProposal } from "./execute-proposal";
import { findRescheduleSlots } from "./find-reschedule-slots";
import { listBookingHistory, listBookings } from "./list-bookings";
import { proposeCancellation, proposeReschedule } from "./propose-booking-change";
import { reconcilePendingActions, takeBookingNotices } from "./reconcile-pending-actions";

// Cancelling and moving a booking the person already has, driven through the use cases with
// in-memory ports: the card's terms come from the world, nothing changes without a grant for the
// card's exact fingerprint, a 503 is retried with the same key and "cancelled" waits for the
// booking's status, and a refused move offers other slots on a fresh card that needs its own tap.

const SESSION = "ses_1";
const USER = "dev-user";
const PLACE = { traceId: SESSION, sessionId: SESSION };
/** Wednesday 2026-11-04, 09:00 IST. */
const START_MS = Date.parse("2026-11-04T03:30:00Z");
const HOUR_MS = 60 * 60 * 1_000;

function slotAt(date: string, hour: number): Slot {
  const pad = (value: number) => String(value).padStart(2, "0");
  return { start: `${date}T${pad(hour)}:00:00+05:30`, end: `${date}T${pad(hour + 1)}:00:00+05:30` };
}

const BOOKED_SLOT = slotAt("2026-11-09", 11);
const SATURDAY_FREE = [slotAt("2026-11-07", 8), slotAt("2026-11-07", 14), slotAt("2026-11-07", 15), slotAt("2026-11-07", 18)];

const POLICY: CancellationPolicy = { freeUntilHoursBefore: 4, lateFee: { kind: "flat", amountInr: 149 } };

const PROVIDER: ProviderDetails = {
  id: "prv_ac_1",
  name: "Ravi Aircon Experts",
  service: "ac_servicing",
  area: "Koramangala",
  priceInr: 999,
  rating: 4,
  reviewCount: 40,
  freeSlots: [],
  attributes: [],
  about: "",
  cancellationTerms: "Free cancellation up to 4 hours before the visit; ₹149 after that.",
  cancellationPolicy: POLICY,
  reviews: [],
  photos: [],
};

class StepClock implements Clock {
  ms = START_MS;
  now() {
    return new Date(this.ms);
  }
}

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
    this.proposals.delete(proposal.proposalId);
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

class MemoryLedger implements ActionLedger {
  readonly intents = new Map<string, ActionIntent>();
  async record<T extends ActionIntent>(intent: T): Promise<T> {
    const existing = this.intents.get(intent.idempotencyKey);
    if (existing !== undefined) return existing as T;
    this.intents.set(intent.idempotencyKey, intent);
    return intent;
  }
  async find(key: string) {
    return this.intents.get(key);
  }
  async advance(next: ActionIntent) {
    if (this.intents.get(next.idempotencyKey)?.version !== next.version - 1) return false;
    this.intents.set(next.idempotencyKey, next);
    return true;
  }
  #matching(query: ActionIntentQuery) {
    return [...this.intents.values()].filter(
      (intent) => (query.sessionId === undefined || intent.sessionId === query.sessionId) && (query.grantId === undefined || intent.grantId === query.grantId),
    );
  }
  async unresolved(query: ActionIntentQuery = {}) {
    return this.#matching(query).filter((intent) => intent.state === "pending" || intent.state === "unknown");
  }
  async list(query: ActionIntentQuery) {
    return this.#matching(query);
  }
  async discardAll() {
    this.intents.clear();
  }
}

/** The person's bookings with one provider, and how its cancel and reschedule calls behave. */
class FakeWorld implements Partial<ProviderWorld> {
  readonly bookings = new Map<string, Booking>();
  /** Cancel calls that answer 503 before one goes through. */
  cancelFailures = 0;
  /** Reschedule targets starting at these IST hours are refused. */
  conflictHours: number[] = [];
  /** The provider's free slots on Saturday. */
  freeSlots: Slot[] = [...SATURDAY_FREE];
  readonly cancelCalls: string[] = [];
  readonly rescheduleCalls: string[] = [];
  readonly listCalls: number[] = [];
  readonly #keys = new Map<string, CancelOutcome | RescheduleOutcome>();

  constructor() {
    this.add({ bookingId: "bkg_seed_3", slot: BOOKED_SLOT, status: "upcoming" });
    this.add({ bookingId: "bkg_seed_1", slot: slotAt("2026-10-11", 10), status: "completed" });
    this.add({ bookingId: "bkg_seed_2", slot: slotAt("2026-09-04", 9), status: "completed" });
  }

  add(booking: Pick<Booking, "bookingId" | "slot" | "status">) {
    this.bookings.set(booking.bookingId, {
      ...booking,
      userId: USER,
      providerId: PROVIDER.id,
      providerName: PROVIDER.name,
      service: PROVIDER.service,
      priceInr: PROVIDER.priceInr,
    });
  }

  async listBookings() {
    this.listCalls.push(1);
    return [...this.bookings.values()];
  }
  async getProvider(providerId: string) {
    return providerId === PROVIDER.id ? { kind: "found" as const, provider: PROVIDER } : { kind: "provider_not_found" as const };
  }
  async searchProviders(query: { readonly dateRange: { readonly from: string; readonly to: string } }): Promise<SearchOutcome> {
    const inRange = this.freeSlots.filter((slot) => slot.start.slice(0, 10) >= query.dateRange.from && slot.start.slice(0, 10) <= query.dateRange.to);
    return { kind: "found", providers: [{ ...PROVIDER, freeSlots: inRange }] };
  }
  async cancel(bookingId: string, key: string): Promise<CancelOutcome> {
    this.cancelCalls.push(key);
    const recorded = this.#keys.get(key);
    if (recorded !== undefined) return recorded as CancelOutcome;
    const booking = this.bookings.get(bookingId);
    if (booking === undefined || booking.status === "cancelled") return { kind: "booking_not_found" };
    if (this.cancelFailures > 0) {
      this.cancelFailures -= 1;
      return { kind: "service_unavailable" };
    }
    this.bookings.set(bookingId, { ...booking, status: "cancelled" });
    const outcome: CancelOutcome = { kind: "cancelled", bookingId };
    this.#keys.set(key, outcome);
    return outcome;
  }
  async reschedule(bookingId: string, slot: Slot, key: string): Promise<RescheduleOutcome> {
    this.rescheduleCalls.push(key);
    const recorded = this.#keys.get(key);
    if (recorded !== undefined) return recorded as RescheduleOutcome;
    const booking = this.bookings.get(bookingId);
    if (booking === undefined || booking.status !== "upcoming") return { kind: "booking_not_found" };
    if (this.conflictHours.includes(Number(slot.start.slice(11, 13)))) return { kind: "slot_conflict" };
    const moved = { ...booking, slot };
    this.bookings.set(bookingId, moved);
    const outcome: RescheduleOutcome = { kind: "rescheduled", booking: moved };
    this.#keys.set(key, outcome);
    return outcome;
  }
}

function setUp() {
  const clock = new StepClock();
  const world = new FakeWorld();
  const proposals = new MemoryProposals();
  const ledger = new MemoryLedger();
  const sink = new MemorySink();
  let id = 0;
  const deps: BookingDependencies = {
    errand: {
      errands: new MemoryErrands(),
      catalog: { services: () => [], areas: () => [], resolveService: () => undefined, resolveArea: () => undefined },
      traceSink: sink,
      clock,
    },
    world: world as unknown as ProviderWorld,
    proposals,
    hasher,
    ids: { next: (prefix) => `${prefix}_${(id += 1)}` },
    worldClock: clock,
    ledger,
  };
  return { clock, world, proposals, ledger, sink, deps };
}

type Setup = ReturnType<typeof setUp>;

async function cancellationCard(setup: Setup): Promise<BookingChangeProposal> {
  const outcome = await proposeCancellation(setup.deps, { place: PLACE, userId: USER, bookingId: "bkg_seed_3" });
  if (outcome.kind !== "proposed") throw new Error(`propose: ${outcome.kind}`);
  return outcome.proposal;
}

async function rescheduleCard(setup: Setup, slot: Slot): Promise<BookingChangeProposal> {
  const outcome = await proposeReschedule(setup.deps, { place: PLACE, userId: USER, bookingId: "bkg_seed_3", slot });
  if (outcome.kind !== "proposed") throw new Error(`propose: ${outcome.kind}`);
  return outcome.proposal;
}

async function approve(setup: Setup, proposal: Proposal): Promise<Grant> {
  const approved = await approveProposal(setup.deps, { proposalId: proposal.proposalId, fingerprint: proposal.fingerprint, userId: USER });
  if (approved.kind !== "approved") throw new Error(`approve: ${approved.kind}`);
  return approved.grant;
}

function execute(setup: Setup) {
  return executeProposal(setup.deps, { place: PLACE });
}

describe("the cancellation fee", () => {
  const booking = { slot: BOOKED_SLOT, priceInr: 1_000 };
  const visitMs = Date.parse(BOOKED_SLOT.start);

  it("is free inside the provider's free window", () => {
    expect(cancellationFeeOf(POLICY, booking, visitMs - 4 * HOUR_MS)).toBe(0);
  });

  it("is the provider's flat fee after the free window closes", () => {
    expect(cancellationFeeOf(POLICY, booking, visitMs - 4 * HOUR_MS + 1)).toBe(149);
  });

  it("is a share of the price when the provider charges a percentage", () => {
    const percent: CancellationPolicy = { freeUntilHoursBefore: 24, lateFee: { kind: "percent_of_price", percent: 20 } };
    expect(cancellationFeeOf(percent, booking, visitMs - HOUR_MS)).toBe(200);
  });
});

describe("proposing a cancellation", () => {
  it("puts the world's booking and the fee by the provider's rule on the card, and changes nothing", async () => {
    const setup = setUp();
    setup.clock.ms = Date.parse(BOOKED_SLOT.start) - HOUR_MS;
    const proposal = await cancellationCard(setup);
    expect(proposal.terms).toMatchObject({ action: "cancel", bookingId: "bkg_seed_3", providerId: PROVIDER.id, slot: BOOKED_SLOT, priceInr: 149, bookingPriceInr: 999 });
    expect(proposal.fingerprint).toBe(fingerprintOf(proposal.terms, hasher));
    expect(setup.world.bookings.get("bkg_seed_3")?.status).toBe("upcoming");
    expect(setup.world.cancelCalls).toEqual([]);
  });

  it("refuses a booking that is already past", async () => {
    const setup = setUp();
    const outcome = await proposeCancellation(setup.deps, { place: PLACE, userId: USER, bookingId: "bkg_seed_1" });
    expect(outcome.kind).toBe("not_changeable");
    expect(setup.proposals.proposals.size).toBe(0);
  });

  it("refuses a booking the person doesn't have", async () => {
    const outcome = await proposeCancellation(setUp().deps, { place: PLACE, userId: USER, bookingId: "bkg_9999" });
    expect(outcome.kind).toBe("booking_not_found");
  });

  it("shows the same card again rather than a second one for the same cancellation", async () => {
    const setup = setUp();
    const first = await cancellationCard(setup);
    const again = await cancellationCard(setup);
    expect(again.proposalId).toBe(first.proposalId);
  });
});

describe("cancelling", () => {
  it("cancels nothing without a tap on Approve", async () => {
    const setup = setUp();
    await cancellationCard(setup);
    expect((await execute(setup)).kind).toBe("not_approved");
    expect(setup.world.cancelCalls).toEqual([]);
    expect(setup.world.bookings.get("bkg_seed_3")?.status).toBe("upcoming");
  });

  it("a 503 is retried with the same key, and cancelled is said only after the status shows it", async () => {
    const setup = setUp();
    setup.world.cancelFailures = 1;
    const proposal = await cancellationCard(setup);
    const grant = await approve(setup, proposal);
    const listsBefore = setup.world.listCalls.length;

    const outcome = await execute(setup);
    expect(outcome.kind).toBe("cancelled");
    expect(setup.world.cancelCalls).toEqual([`cancel:${grant.grantId}`, `cancel:${grant.grantId}`]);
    // One status read after each attempt: the 503 left it upcoming, the retry left it cancelled.
    expect(setup.world.listCalls.length - listsBefore).toBeGreaterThanOrEqual(2);
    expect(setup.world.bookings.get("bkg_seed_3")?.status).toBe("cancelled");
    expect(setup.ledger.intents.get(`cancel:${grant.grantId}`)).toMatchObject({ state: "confirmed", attempts: 2, targetBookingId: "bkg_seed_3" });
    expect((await setup.proposals.grantOf(proposal.proposalId))?.consumedAtMs).toBeDefined();
    expect((await setup.proposals.findProposal(proposal.proposalId))?.status).toBe("executed");
  });

  it("gives up after three 503s and says nothing was cancelled", async () => {
    const setup = setUp();
    setup.world.cancelFailures = 5;
    const proposal = await cancellationCard(setup);
    const grant = await approve(setup, proposal);

    const outcome = await execute(setup);
    expect(outcome).toMatchObject({ kind: "change_failed", reason: "service_unavailable" });
    expect(setup.world.cancelCalls).toHaveLength(3);
    expect(new Set(setup.world.cancelCalls)).toEqual(new Set([`cancel:${grant.grantId}`]));
    expect(setup.world.bookings.get("bkg_seed_3")?.status).toBe("upcoming");
  });

  it("asking again after it was cancelled cancels nothing more", async () => {
    const setup = setUp();
    await approve(setup, await cancellationCard(setup));
    await execute(setup);
    const again = await execute(setup);
    expect(again.kind).toBe("already_changed");
    expect(setup.world.cancelCalls).toHaveLength(1);
  });

  it("a fee that started after the approval voids the grant and puts the new fee on a fresh card", async () => {
    const setup = setUp();
    setup.clock.ms = Date.parse(BOOKED_SLOT.start) - 4 * HOUR_MS - 60_000;
    const proposal = await cancellationCard(setup);
    expect(proposal.terms.priceInr).toBe(0);
    const grant = await approve(setup, proposal);
    setup.clock.ms += 2 * 60_000;

    const outcome = await execute(setup);
    if (outcome.kind !== "approval_invalidated") throw new Error(outcome.kind);
    expect(outcome.changes).toEqual([{ field: "price", from: 0, to: 149 }]);
    expect(outcome.freshProposal.terms.priceInr).toBe(149);
    expect((await setup.proposals.grantOf(proposal.proposalId))?.voidedAtMs).toBeDefined();
    expect(await setup.proposals.grantOf(outcome.freshProposal.proposalId)).toBeUndefined();
    expect(setup.world.cancelCalls).toEqual([]);
    expect(grant.consumedAtMs).toBeUndefined();
  });

  it("declining the card leaves the booking as it was", async () => {
    const setup = setUp();
    const proposal = await cancellationCard(setup);
    const declined = await declineProposal(setup.deps, { proposalId: proposal.proposalId, userId: USER });
    expect(declined.kind).toBe("declined");
    expect((await execute(setup)).kind).toBe("declined");
    expect(setup.world.bookings.get("bkg_seed_3")?.status).toBe("upcoming");
  });

  it("the reconciler finishes a cancel a crash left pending, without sending it twice", async () => {
    const setup = setUp();
    const proposal = await cancellationCard(setup);
    const grant = await approve(setup, proposal);
    // The process sent cancel (the world took it) and died before recording the reply.
    await setup.ledger.record({ ...bookingChangeIntentFor(proposal, grant, setup.clock.ms), attempts: 1 });
    await setup.world.cancel("bkg_seed_3", `cancel:${grant.grantId}`);

    const { resolved } = await reconcilePendingActions(setup.deps, {});
    expect(resolved.map((intent) => [intent.action, intent.state])).toEqual([["cancel", "confirmed"]]);
    expect(setup.world.cancelCalls).toHaveLength(1);
    const [notice] = await takeBookingNotices(setup.deps, { sessionId: SESSION });
    expect(notice?.kind).toBe("cancelled");
  });

  it("lists the cancellation with its consumed grant on the booking", async () => {
    const setup = setUp();
    const proposal = await cancellationCard(setup);
    const grant = await approve(setup, proposal);
    await execute(setup);
    const booking = (await listBookings(setup.deps, USER)).find((listed) => listed.booking.bookingId === "bkg_seed_3");
    expect(booking?.changes.map((change) => [change.proposal.proposalId, change.grant?.grantId, change.grant?.consumedAtMs !== undefined])).toEqual([
      [proposal.proposalId, grant.grantId, true],
    ]);
  });
});

describe("rescheduling", () => {
  it("offers the provider's free slots on the day asked, never the booking's own", async () => {
    const setup = setUp();
    const found = await findRescheduleSlots(setup.deps, { userId: USER, bookingId: "bkg_seed_3", dates: { from: "2026-11-07", to: "2026-11-07" } });
    expect(found).toMatchObject({ kind: "slots", slots: SATURDAY_FREE });
  });

  it("puts the old time next to the new one on the card", async () => {
    const setup = setUp();
    const proposal = await rescheduleCard(setup, SATURDAY_FREE[1] as Slot);
    expect(proposal.terms).toMatchObject({ action: "reschedule", fromSlot: BOOKED_SLOT, slot: SATURDAY_FREE[1], priceInr: 999 });
  });

  it("refuses a slot the provider doesn't have free, offering the closest ones", async () => {
    const outcome = await proposeReschedule(setUp().deps, { place: PLACE, userId: USER, bookingId: "bkg_seed_3", slot: slotAt("2026-11-07", 11) });
    if (outcome.kind !== "slot_unavailable") throw new Error(outcome.kind);
    expect(outcome.alternatives.map((slot) => slot.start.slice(11, 13))).toEqual(["08", "14", "15"]);
  });

  it("moves the booking once, on the approved slot, after the tap", async () => {
    const setup = setUp();
    const proposal = await rescheduleCard(setup, SATURDAY_FREE[1] as Slot);
    expect((await execute(setup)).kind).toBe("not_approved");
    const grant = await approve(setup, proposal);
    expect((await execute(setup)).kind).toBe("rescheduled");
    expect(setup.world.rescheduleCalls).toEqual([`reschedule:${grant.grantId}`]);
    expect(setup.world.bookings.get("bkg_seed_3")?.slot).toEqual(SATURDAY_FREE[1]);
  });

  it("a slot conflict moves nothing, offers other slots and a fresh card that needs its own tap", async () => {
    const setup = setUp();
    setup.world.conflictHours = [8];
    const proposal = await rescheduleCard(setup, SATURDAY_FREE[0] as Slot);
    await approve(setup, proposal);

    const outcome = await execute(setup);
    if (outcome.kind !== "reschedule_conflict") throw new Error(outcome.kind);
    expect(setup.world.bookings.get("bkg_seed_3")?.slot).toEqual(BOOKED_SLOT);
    expect(outcome.alternatives.map((slot) => slot.start.slice(11, 13))).toEqual(["14", "15", "18"]);
    expect(outcome.freshProposal?.terms).toMatchObject({ action: "reschedule", slot: SATURDAY_FREE[1], fromSlot: BOOKED_SLOT });
    expect(setup.world.rescheduleCalls).toHaveLength(1);

    // The old grant is spent and the fresh card has none: nothing moves until the person taps it.
    expect((await execute(setup)).kind).toBe("not_approved");
    expect(setup.world.rescheduleCalls).toHaveLength(1);
    if (outcome.freshProposal === undefined) throw new Error("no fresh card");
    await approve(setup, outcome.freshProposal);
    expect((await execute(setup)).kind).toBe("rescheduled");
    expect(setup.world.bookings.get("bkg_seed_3")?.slot).toEqual(SATURDAY_FREE[1]);
  });
});

describe("the booking history", () => {
  it("lists upcoming bookings soonest first and past ones most recent first, with the provider's area", async () => {
    const setup = setUp();
    const history = await listBookingHistory(setup.deps, USER);
    expect(history.upcoming.map((record) => record.booking.bookingId)).toEqual(["bkg_seed_3"]);
    expect(history.past.map((record) => record.booking.bookingId)).toEqual(["bkg_seed_1", "bkg_seed_2"]);
    expect(history.past[0]?.area).toBe("Koramangala");
  });
});
