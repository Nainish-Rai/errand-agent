import { openErrand, type Errand } from "../errand/errand";
import { isFinished } from "../errand/errand-workflow";
import { selectContext } from "../memory/context-selection";
import type { Clock } from "../ports/clock";
import type { ErrandStore } from "../ports/errand-store";
import type { MemoryStore } from "../ports/memory-store";
import type { PersonNotifier } from "../ports/person-notifier";
import type { ProposalStore } from "../ports/proposal-store";
import type { ProviderEventLog } from "../ports/provider-event-log";
import type { ProviderWorld } from "../ports/provider-world";
import type { TraceAttributes, TraceSink } from "../ports/trace-sink";
import {
  cancelledVisitOf,
  decideNotice,
  replacementDetails,
  type CancelledVisit,
  type NoticeSkipReason,
} from "../provider-events/provider-cancellation";
import { traceNewTransitions } from "./errand-session";

// HandleProviderCancelled: the provider network says a provider cancelled a booking. Each event is
// handled once, however often it is delivered: its id is recorded first, and a delivery of an
// event already decided changes nothing. If the visit still matters to the person, the chat that
// booked it (or a new chat) gets a replacement errand built from their current saved preferences,
// with the cancelling provider excluded, and a provider update that starts the agent's turn. The
// agent then searches and shows a fresh approval card; nothing is booked until the person taps it.

export interface ProviderEventDependencies {
  readonly events: ProviderEventLog;
  readonly world: ProviderWorld;
  readonly proposals: ProposalStore;
  readonly errands: ErrandStore;
  readonly memory: MemoryStore;
  readonly notifier: PersonNotifier;
  readonly traceSink: TraceSink;
  /** The world's clock: whether a visit is past, and when the alert was raised. */
  readonly worldClock: Clock;
  /** The trace's clock, for the errand's transitions and the trace event. */
  readonly wallClock: Clock;
}

export interface ProviderCancelledRequest {
  readonly eventId: string;
  readonly bookingId: string;
  /** The world's user the booking must belong to (from the auth context). */
  readonly userId: string;
  /** Whose saved preferences shape the replacement (from the auth context). */
  readonly ownerId: string;
}

export type HandleProviderCancelledOutcome =
  | {
      readonly kind: "notified";
      readonly sessionId: string;
      readonly deliveryId: string;
      readonly visit: CancelledVisit;
      /** True when an earlier delivery of the event had started the notice and this one finished it. */
      readonly resumed: boolean;
    }
  | { readonly kind: "skipped"; readonly reason: NoticeSkipReason }
  /** The event was already decided; this delivery changed nothing. */
  | {
      readonly kind: "duplicate";
      readonly decision: "skipped" | "notified";
      readonly skipReason?: NoticeSkipReason;
      readonly sessionId?: string;
    };

/** The key every attempt at one event's notice uses, in our log and in the chat. */
export function noticeKeyOf(eventId: string): string {
  return `provider-cancelled:${eventId}`;
}

function eventTrace(sessionId: string, name: string, atMs: number, attributes: TraceAttributes) {
  return {
    type: "event" as const,
    traceId: sessionId,
    eventId: `${String(attributes["errand.provider_event.id"])}:${name}`,
    sessionId,
    kind: "provider_event" as const,
    name,
    timeMs: atMs,
    attributes,
  };
}

/** The chat that booked the visit, unless it is busy with another errand; otherwise a new chat. */
async function chatFor(deps: ProviderEventDependencies, visit: CancelledVisit, eventId: string): Promise<string> {
  const booked = await deps.proposals.findProposalByBooking(visit.bookingId);
  if (booked !== undefined) {
    const errand = await deps.errands.find(booked.sessionId);
    const isFree = errand === undefined || isFinished(errand.state) || errand.replacing?.bookingId === visit.bookingId;
    if (isFree) return booked.sessionId;
  }
  return (await deps.notifier.openChat(noticeKeyOf(eventId))).sessionId;
}

/** Starts the replacement errand in the chat, once: a resumed notice finds it already there. */
async function openReplacementErrand(
  deps: ProviderEventDependencies,
  request: ProviderCancelledRequest,
  sessionId: string,
  visit: CancelledVisit,
): Promise<void> {
  const memory = await deps.memory.read(request.ownerId);
  const nowMs = deps.worldClock.now().getTime();
  const usable = selectContext(memory.facts, undefined, nowMs).included.map(({ fact }) => fact);
  const provider = await deps.world.getProvider(visit.providerId);
  const fallbackArea = provider.kind === "found" ? provider.provider.area : "";
  const details = replacementDetails(visit, usable, fallbackArea, nowMs);
  const place = { traceId: sessionId, sessionId };
  await deps.errands.change(sessionId, async (current) => {
    if (current?.replacing?.bookingId === visit.bookingId) return { result: undefined };
    const opened = openErrand(sessionId, deps.wallClock.now().getTime());
    const errand: Errand = {
      ...opened,
      // A chat can hold one errand at a time; the replacement gets its own id so its trace is its own.
      errandId: `${opened.errandId}_rebook_${visit.bookingId}`,
      details,
      replacing: { bookingId: visit.bookingId, providerId: visit.providerId, providerName: visit.providerName },
    };
    await traceNewTransitions(deps.traceSink, undefined, errand, place);
    return { errand, result: undefined };
  });
}

async function notified(
  deps: ProviderEventDependencies,
  request: ProviderCancelledRequest,
  visit: CancelledVisit,
  resumed: boolean,
  knownSessionId: string | undefined,
): Promise<HandleProviderCancelledOutcome> {
  const sessionId = knownSessionId ?? (await chatFor(deps, visit, request.eventId));
  const claimed = await deps.events.claimNotice(request.eventId, { sessionId, visit, atMs: deps.worldClock.now().getTime() });
  if (!claimed) {
    await deps.events.skip(request.eventId, "already_notified");
    return { kind: "skipped", reason: "already_notified" };
  }
  await openReplacementErrand(deps, request, sessionId, visit);
  const { deliveryId } = await deps.notifier.notify(sessionId, { idempotencyKey: noticeKeyOf(request.eventId), visit });
  await deps.events.markNotified(request.eventId, deps.worldClock.now().getTime());
  await deps.traceSink.record(
    eventTrace(sessionId, `provider cancelled ${visit.bookingId}: notified`, deps.wallClock.now().getTime(), {
      "errand.provider_event.id": request.eventId,
      "errand.provider_event.booking_id": visit.bookingId,
      "errand.provider_event.provider_id": visit.providerId,
      "errand.provider_event.decision": "notified",
      "errand.provider_event.resumed": resumed,
    }),
  );
  return { kind: "notified", sessionId, deliveryId, visit, resumed };
}

export async function handleProviderCancelled(
  deps: ProviderEventDependencies,
  request: ProviderCancelledRequest,
): Promise<HandleProviderCancelledOutcome> {
  const { first, record } = await deps.events.receive({
    eventId: request.eventId,
    bookingId: request.bookingId,
    userId: request.userId,
    atMs: deps.worldClock.now().getTime(),
  });
  if (record.decision === "skipped") {
    return { kind: "duplicate", decision: "skipped", ...(record.skipReason === undefined ? {} : { skipReason: record.skipReason }) };
  }
  if (record.decision === "notified") {
    return { kind: "duplicate", decision: "notified", ...(record.sessionId === undefined ? {} : { sessionId: record.sessionId }) };
  }
  // A notice an earlier delivery started (and a crash cut short) is finished with the same key, so
  // the chat still takes it once.
  if (record.decision === "notifying" && record.visit !== undefined) {
    return notified(deps, request, record.visit, true, record.sessionId);
  }

  const booking = (await deps.world.listBookings(request.userId)).find((candidate) => candidate.bookingId === request.bookingId);
  const decision = decideNotice(
    booking,
    deps.worldClock.now().getTime(),
    await deps.events.isBookingNotified(request.bookingId, request.eventId),
  );
  if (decision.kind === "skip" || booking === undefined) {
    const reason = decision.kind === "skip" ? decision.reason : "unknown_booking";
    await deps.events.skip(request.eventId, reason);
    return { kind: "skipped", reason };
  }
  return notified(deps, request, cancelledVisitOf(booking), !first, undefined);
}
