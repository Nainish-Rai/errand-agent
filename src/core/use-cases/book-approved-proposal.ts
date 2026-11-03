import type { Grant } from "../approval/grant";
import type { Proposal } from "../approval/proposal";
import { bookingIntentFor, isResolved, ledgerEvent, type ActionIntent } from "../booking/action-intent";
import type { Errand } from "../errand/errand";
import { selectOptions, type ErrandOption } from "../errand/errand-options";
import type { ErrandState, TracePlace } from "../errand/errand-workflow";
import type { ActionLedger } from "../ports/action-ledger";
import { moved, withoutHold, type ProposalDependencies } from "./proposal-session";
import { reproposeExpiredHold, type ApprovalRevalidationOutcome } from "./revalidate-approval";
import { settleActionIntent, type LedgerDependencies } from "./settle-action-intent";

// The booking path after every approval check has passed: the ledger records the intent, the
// grant is used, `book` is sent with the grant's key, and the outcome comes from the world's
// status. The same mapping from a settled intent to the proposal, the errand and the person's
// outcome serves the reconciler, which settles the intents an execution left unresolved.

export interface BookingDependencies extends ProposalDependencies {
  readonly ledger: ActionLedger;
}

export type BookingOutcome =
  /** The world's status names this booking ID for the grant's key. */
  | { readonly kind: "booked"; readonly proposal: Proposal; readonly bookingId: string; readonly intent: ActionIntent }
  /** Someone else got the slot first. Nothing was booked; the next options are on screen, and picking one needs a new approval. */
  | { readonly kind: "slot_taken"; readonly proposal: Proposal; readonly alternatives: readonly ErrandOption[]; readonly intent: ActionIntent }
  /** The world can't say yet whether it booked. Not booked, not failed; the reconciler settles it later. */
  | { readonly kind: "verifying"; readonly proposal: Proposal; readonly intent: ActionIntent }
  | { readonly kind: "booking_failed"; readonly proposal: Proposal; readonly reason: string; readonly intent: ActionIntent };

export interface SettledBooking {
  /**
   * The booking's outcome; or, when `book` found the hold run out, what 06's re-proposal did
   * instead (the slot held again for a fresh card, or lost). The intent is failed with
   * `hold_expired` either way: an expired hold is never retried.
   */
  readonly outcome: BookingOutcome | ApprovalRevalidationOutcome;
  /** The errand after the outcome, when there is one to move (a restart loses errands). */
  readonly errand?: Errand;
}

export function ledgerDependenciesOf(deps: BookingDependencies): LedgerDependencies {
  return {
    world: deps.world,
    ledger: deps.ledger,
    traceSink: deps.errand.traceSink,
    clock: deps.errand.clock,
    worldClock: deps.worldClock,
  };
}

/** States a booking outcome may still move the errand out of; a finished or moved-on errand keeps its state. */
const IN_EXECUTION: readonly ErrandState[] = ["executing", "verifying"];

function movedIfExecuting(errand: Errand | undefined, deps: BookingDependencies, move: (errand: Errand) => Errand): Errand | undefined {
  if (errand === undefined || !IN_EXECUTION.includes(errand.state)) return undefined;
  return move(errand);
}

/** The errand's next options after its slot was taken: the same search, minus what is no longer free. */
async function nextOptions(errand: Errand | undefined, deps: BookingDependencies): Promise<readonly ErrandOption[]> {
  const { service, area, timeWindow } = errand?.details ?? {};
  if (errand === undefined || service === undefined || area === undefined || timeWindow === undefined) return [];
  const found = await deps.world.searchProviders({ service, area, dateRange: timeWindow.dates });
  if (found.kind !== "found") return [];
  return selectOptions(found.providers, { ...errand.details, timeWindow }).options;
}

/** What a settled (or still unsettled) intent means for its proposal, its errand and the person. */
export async function settledBooking(
  deps: BookingDependencies,
  request: { readonly errand: Errand | undefined; readonly proposal: Proposal; readonly intent: ActionIntent },
): Promise<SettledBooking> {
  const { proposal, intent } = request;
  const { clock } = deps.errand;
  // A crash after `book` was sent can leave the errand still awaiting this approval (its move to
  // executing died with the process): it was carried out, so it moves on from there.
  const errand =
    request.errand?.state === "awaiting_approval" && request.errand.hold?.holdId === intent.holdId
      ? moved(request.errand, "executing", "approved", clock)
      : request.errand;
  switch (intent.state) {
    case "confirmed": {
      const bookingId = intent.bookingId;
      if (bookingId === undefined) throw new Error(`Confirmed intent ${intent.idempotencyKey} has no booking ID.`);
      const executed: Proposal = { ...proposal, status: "executed", bookingId };
      await deps.proposals.saveProposal(executed);
      const next = movedIfExecuting(errand, deps, (current) => moved(withoutHold(current), "done", "booking_verified", clock));
      return { outcome: { kind: "booked", proposal: executed, bookingId, intent }, ...(next === undefined ? {} : { errand: next }) };
    }
    case "failed": {
      // `book` itself found the hold run out (06): hold the slot again for a fresh card, in this
      // turn. Later, when the reconciler finds a hold ran out while verifying, the errand fails.
      if (intent.failureReason === "hold_expired" && errand?.state === "executing") return reproposeExpiredHold(errand, proposal, deps);
      const failed: Proposal = { ...proposal, status: "failed" };
      await deps.proposals.saveProposal(failed);
      if (intent.failureReason === "slot_taken") {
        // Back to the options: the next pick is a new hold, a new card and a new approval.
        const next = movedIfExecuting(errand, deps, (current) => moved(withoutHold(current), "choosing", "slot_taken", clock));
        const alternatives = next === undefined ? [] : await nextOptions(next, deps);
        return { outcome: { kind: "slot_taken", proposal: failed, alternatives, intent }, ...(next === undefined ? {} : { errand: next }) };
      }
      const next = movedIfExecuting(errand, deps, (current) => moved(withoutHold(current), "failed", "booking_failed", clock));
      const reason = intent.failureReason ?? "unknown";
      return { outcome: { kind: "booking_failed", proposal: failed, reason, intent }, ...(next === undefined ? {} : { errand: next }) };
    }
    case "pending":
    case "unknown": {
      const verifying: Proposal = { ...proposal, status: "verifying" };
      await deps.proposals.saveProposal(verifying);
      const next =
        errand?.state === "executing" ? moved(errand, "verifying", "awaiting_verification", clock) : undefined;
      return { outcome: { kind: "verifying", proposal: verifying, intent }, ...(next === undefined ? {} : { errand: next }) };
    }
  }
}

/** What the ledger says about an intent someone else is carrying out, changing nothing. */
function reportedOutcome(proposal: Proposal, intent: ActionIntent): BookingOutcome {
  if (intent.state === "confirmed" && intent.bookingId !== undefined) return { kind: "booked", proposal, bookingId: intent.bookingId, intent };
  if (intent.state === "failed" && intent.failureReason === "slot_taken") return { kind: "slot_taken", proposal, alternatives: [], intent };
  if (intent.state === "failed") return { kind: "booking_failed", proposal, reason: intent.failureReason ?? "unknown", intent };
  return { kind: "verifying", proposal, intent };
}

/**
 * Records the intent, uses the grant and books. The intent is written before the grant is used,
 * so no crash can leave a used grant the ledger doesn't know about; a crash between the two leaves
 * an intent whose grant is still unused, which the next execution or the reconciler carries on.
 */
export async function bookApprovedProposal(
  deps: BookingDependencies,
  request: { readonly errand: Errand; readonly proposal: Proposal; readonly grant: Grant; readonly place: TracePlace },
): Promise<SettledBooking> {
  const { proposal, grant, place } = request;
  const fresh = bookingIntentFor(proposal, grant, deps.errand.clock.now().getTime());
  const intent = await deps.ledger.record(fresh);
  if (intent.version === fresh.version && intent.createdAtMs === fresh.createdAtMs) {
    await deps.errand.traceSink.record(ledgerEvent(undefined, intent, place));
  }

  if (!(await deps.proposals.consumeGrant(grant.grantId, deps.worldClock.now().getTime()))) {
    // Another execution used the grant between the checks and here, and is carrying out this same
    // intent (ACP's 409: in flight). Report what the ledger says, and leave the proposal and the
    // errand to that execution.
    return { outcome: reportedOutcome(proposal, (await deps.ledger.find(intent.idempotencyKey)) ?? intent) };
  }

  const executing: Proposal = { ...proposal, status: "executing" };
  await deps.proposals.saveProposal(executing);
  const started = moved(request.errand, "executing", "approved", deps.errand.clock);
  const settled = await settleActionIntent(ledgerDependenciesOf(deps), { intent, place, by: "execution" });
  return settledBooking(deps, { errand: started, proposal: executing, intent: settled });
}

/**
 * The grant was used before this execution got to it: by an execution still in flight, one that
 * timed out, or one that crashed. The ledger knows which; an unresolved intent is settled now with
 * the same key, so asking again never books twice.
 */
export async function bookingOfUsedGrant(
  deps: BookingDependencies,
  request: { readonly errand: Errand | undefined; readonly proposal: Proposal; readonly grant: Grant; readonly place: TracePlace },
): Promise<SettledBooking> {
  const { proposal, grant, place } = request;
  // A grant used before the ledger existed (or by a crash in between) has no intent yet. A `book`
  // may have been sent, so it counts as one attempt and the status is read before anything else.
  const unknown: ActionIntent = { ...bookingIntentFor(proposal, grant, deps.errand.clock.now().getTime()), attempts: 1 };
  const intent = await deps.ledger.record(unknown);
  const settled = isResolved(intent) ? intent : await settleActionIntent(ledgerDependenciesOf(deps), { intent, place, by: "execution" });
  return settledBooking(deps, { errand: request.errand, proposal, intent: settled });
}
