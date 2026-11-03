import { isConsumed } from "../approval/grant";
import { isBookingChangeProposal, isBookingProposal, type BookingChangeProposal, type BookingProposal, type Proposal } from "../approval/proposal";
import {
  awaitsNotice,
  isResolved,
  noticeDelivered,
  type ActionIntent,
  type BookingChangeIntent,
  type BookingIntent,
} from "../booking/action-intent";
import type { ActionIntentQuery } from "../ports/action-ledger";
import { ledgerDependenciesOf, settledBooking, type BookingDependencies, type BookingOutcome } from "./book-approved-proposal";
import { traceNewTransitions } from "./errand-session";
import { sessionPlace } from "./proposal-session";
import { settledBookingChange, type BookingChangeOutcome } from "./change-approved-booking";
import { settleActionIntent } from "./settle-action-intent";
import { settleBookingChange } from "./settle-booking-change";

// ReconcilePendingActions: settles every intent an execution left pending or unknown (a timeout
// the status couldn't settle, a run cut off at its deadline, a backend killed mid-call) through
// `get_booking_status` with the intent's own key. It runs when the backend starts and at the start
// of every turn. Its resolutions wait in the ledger until the person has been told
// (TakeBookingNotices), so a booking confirmed while nobody was looking is still announced.
// Cancellations and reschedules left unsettled are settled the same way, through the booking's
// status in `list_bookings`.

/** An update the person is owed about a booking, or about a change to one. */
export type BookingNotice = BookingOutcome | BookingChangeOutcome;

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

async function reconciledBooking(deps: BookingDependencies, intent: BookingIntent, proposal: BookingProposal): Promise<ActionIntent> {
  const place = sessionPlace(intent.sessionId);
  const settled = await settleActionIntent(ledgerDependenciesOf(deps), { intent, place, by: "reconciler" });
  await deps.errand.errands.change(intent.sessionId, async (current) => {
    const stored = await deps.proposals.findProposal(intent.proposalId);
    const latest = stored !== undefined && isBookingProposal(stored) ? stored : proposal;
    const { errand } = await settledBooking(deps, { errand: current, proposal: latest, intent: settled });
    if (errand === undefined) return { result: undefined };
    await traceNewTransitions(deps.errand.traceSink, current, errand, place);
    return { errand, result: undefined };
  });
  return settled;
}

async function reconciledChange(deps: BookingDependencies, intent: BookingChangeIntent, proposal: BookingChangeProposal): Promise<ActionIntent> {
  const settled = await settleBookingChange(ledgerDependenciesOf(deps), { intent, place: sessionPlace(intent.sessionId), by: "reconciler" });
  // In the session's queue, so an execution of the same card sees what this pass did.
  await deps.errand.errands.change(intent.sessionId, async () => {
    const stored = await deps.proposals.findProposal(intent.proposalId);
    await settledBookingChange(deps, { proposal: stored !== undefined && isBookingChangeProposal(stored) ? stored : proposal, intent: settled });
    return { result: undefined };
  });
  return settled;
}

async function reconciled(deps: BookingDependencies, intent: ActionIntent): Promise<ActionIntent | undefined> {
  const proposal = await deps.proposals.findProposal(intent.proposalId);
  if (proposal === undefined) return undefined;
  const grant = await deps.proposals.grantOf(intent.proposalId);
  // A crash between recording the intent and using the grant: the intent is the person's go-ahead,
  // so the grant is used now. The store decides atomically, so a racing execution can't use it too.
  if (grant !== undefined && !isConsumed(grant)) await deps.proposals.consumeGrant(grant.grantId, deps.worldClock.now().getTime());

  if (intent.action === "book") return isBookingProposal(proposal) ? reconciledBooking(deps, intent, proposal) : undefined;
  return isBookingChangeProposal(proposal) ? reconciledChange(deps, intent, proposal) : undefined;
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
export async function takeBookingNotices(deps: BookingDependencies, request: { readonly sessionId: string }): Promise<readonly BookingNotice[]> {
  const notices: BookingNotice[] = [];
  for (const intent of await deps.ledger.list({ sessionId: request.sessionId })) {
    if (!awaitsNotice(intent)) continue;
    if (!(await deps.ledger.advance(noticeDelivered(intent, deps.errand.clock.now().getTime())))) continue;
    const proposal = await deps.proposals.findProposal(intent.proposalId);
    const notice = proposal === undefined ? undefined : noticeOf(intent, proposal);
    if (notice !== undefined) notices.push(notice);
  }
  return notices;
}

function bookingNoticeOf(intent: BookingIntent, proposal: BookingProposal): BookingOutcome {
  if (intent.state === "confirmed" && intent.bookingId !== undefined) return { kind: "booked", proposal, bookingId: intent.bookingId, intent };
  if (intent.failureReason === "slot_taken") return { kind: "slot_taken", proposal, alternatives: [], intent };
  return { kind: "booking_failed", proposal, reason: intent.failureReason ?? "unknown", intent };
}

function changeNoticeOf(intent: BookingChangeIntent, proposal: BookingChangeProposal): BookingChangeOutcome {
  if (intent.state === "confirmed") {
    return proposal.terms.action === "cancel"
      ? { kind: "cancelled", proposal: { ...proposal, terms: proposal.terms }, intent }
      : { kind: "rescheduled", proposal: { ...proposal, terms: proposal.terms }, intent };
  }
  return { kind: "change_failed", proposal, reason: intent.failureReason ?? "unknown", intent };
}

/** The update a resolved intent owes the person, by what it was for. */
function noticeOf(intent: ActionIntent, proposal: Proposal): BookingNotice | undefined {
  if (intent.action === "book") return isBookingProposal(proposal) ? bookingNoticeOf(intent, proposal) : undefined;
  return isBookingChangeProposal(proposal) ? changeNoticeOf(intent, proposal) : undefined;
}

export interface ActionIntentStanding {
  readonly intent: ActionIntent;
  /** The update the reconciler's settlement owes the person, when the reconciler settled it. */
  readonly notice?: BookingNotice;
}

/** The ledger's intents, oldest first: the app API's view of what was attempted and how it ended. */
export async function listActionIntents(
  deps: Pick<BookingDependencies, "ledger" | "proposals">,
  query: ActionIntentQuery,
): Promise<readonly ActionIntentStanding[]> {
  const standings: ActionIntentStanding[] = [];
  for (const intent of await deps.ledger.list(query)) {
    const proposal = intent.resolvedBy === "reconciler" ? await deps.proposals.findProposal(intent.proposalId) : undefined;
    const notice = proposal === undefined ? undefined : noticeOf(intent, proposal);
    standings.push(notice === undefined ? { intent } : { intent, notice });
  }
  return standings;
}
