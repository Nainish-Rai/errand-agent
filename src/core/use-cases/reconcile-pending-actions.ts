import { isConsumed } from "../approval/grant";
import { awaitsNotice, isResolved, noticeDelivered, type ActionIntent } from "../booking/action-intent";
import type { ActionIntentQuery } from "../ports/action-ledger";
import { ledgerDependenciesOf, settledBooking, type BookingDependencies, type BookingOutcome } from "./book-approved-proposal";
import { traceNewTransitions } from "./errand-session";
import { sessionPlace } from "./proposal-session";
import { settleActionIntent } from "./settle-action-intent";

// ReconcilePendingActions: settles every intent an execution left pending or unknown (a timeout
// the status couldn't settle, a run cut off at its deadline, a backend killed mid-call) through
// `get_booking_status` with the intent's own key. It runs when the backend starts and at the start
// of every turn. Its resolutions wait in the ledger until the person has been told
// (TakeBookingNotices), so a booking confirmed while nobody was looking is still announced.

export interface ReconcileRequest {
  /** Only this session's intents (the start of a turn); absent means every session (startup). */
  readonly sessionId?: string;
}

export interface Reconciliation {
  /** Settled by this pass: confirmed or failed. */
  readonly resolved: readonly ActionIntent[];
  /** Still pending or unknown, including any the world couldn't be asked about this time. */
  readonly unsettled: readonly ActionIntent[];
}

async function reconciled(deps: BookingDependencies, intent: ActionIntent): Promise<ActionIntent | undefined> {
  const proposal = await deps.proposals.findProposal(intent.proposalId);
  if (proposal === undefined) return undefined;
  const grant = await deps.proposals.grantOf(intent.proposalId);
  // A crash between recording the intent and using the grant: the intent is the person's go-ahead,
  // so the grant is used now. The store decides atomically, so a racing execution can't use it too.
  if (grant !== undefined && !isConsumed(grant)) await deps.proposals.consumeGrant(grant.grantId, deps.worldClock.now().getTime());

  const place = sessionPlace(intent.sessionId);
  const settled = await settleActionIntent(ledgerDependenciesOf(deps), { intent, place, by: "reconciler" });
  await deps.errand.errands.change(intent.sessionId, async (current) => {
    const latest = (await deps.proposals.findProposal(intent.proposalId)) ?? proposal;
    const { errand } = await settledBooking(deps, { errand: current, proposal: latest, intent: settled });
    if (errand === undefined) return { result: undefined };
    await traceNewTransitions(deps.errand.traceSink, current, errand, place);
    return { errand, result: undefined };
  });
  return settled;
}

export async function reconcilePendingActions(deps: BookingDependencies, request: ReconcileRequest): Promise<Reconciliation> {
  const query: ActionIntentQuery = request.sessionId === undefined ? {} : { sessionId: request.sessionId };
  const resolved: ActionIntent[] = [];
  const unsettled: ActionIntent[] = [];
  for (const intent of await deps.ledger.unresolved(query)) {
    let settled: ActionIntent | undefined;
    try {
      settled = await reconciled(deps, intent);
    } catch {
      // The world couldn't be asked (it threw). The intent stays as it was, for the next pass.
      settled = undefined;
    }
    if (settled !== undefined && isResolved(settled)) resolved.push(settled);
    else unsettled.push((await deps.ledger.find(intent.idempotencyKey)) ?? intent);
  }
  return { resolved, unsettled };
}

/**
 * Hands over the session's resolutions the person hasn't been told about (the reconciler reached
 * them outside their turn), and marks them told. Each is handed over once.
 */
export async function takeBookingNotices(deps: BookingDependencies, request: { readonly sessionId: string }): Promise<readonly BookingOutcome[]> {
  const notices: BookingOutcome[] = [];
  for (const intent of await deps.ledger.list({ sessionId: request.sessionId })) {
    if (!awaitsNotice(intent)) continue;
    if (!(await deps.ledger.advance(noticeDelivered(intent, deps.errand.clock.now().getTime())))) continue;
    const proposal = await deps.proposals.findProposal(intent.proposalId);
    if (proposal === undefined) continue;
    notices.push(bookingNoticeOf(intent, proposal));
  }
  return notices;
}

function bookingNoticeOf(intent: ActionIntent, proposal: BookingOutcome["proposal"]): BookingOutcome {
  if (intent.state === "confirmed" && intent.bookingId !== undefined) return { kind: "booked", proposal, bookingId: intent.bookingId, intent };
  if (intent.failureReason === "slot_taken") return { kind: "slot_taken", proposal, alternatives: [], intent };
  return { kind: "booking_failed", proposal, reason: intent.failureReason ?? "unknown", intent };
}

export interface ActionIntentStanding {
  readonly intent: ActionIntent;
  /** The update the reconciler's settlement owes the person, when the reconciler settled it. */
  readonly notice?: BookingOutcome;
}

/** The ledger's intents, oldest first: the app API's view of what was attempted and how it ended. */
export async function listActionIntents(
  deps: Pick<BookingDependencies, "ledger" | "proposals">,
  query: ActionIntentQuery,
): Promise<readonly ActionIntentStanding[]> {
  const standings: ActionIntentStanding[] = [];
  for (const intent of await deps.ledger.list(query)) {
    const proposal = intent.resolvedBy === "reconciler" ? await deps.proposals.findProposal(intent.proposalId) : undefined;
    standings.push(proposal === undefined ? { intent } : { intent, notice: bookingNoticeOf(intent, proposal) });
  }
  return standings;
}
