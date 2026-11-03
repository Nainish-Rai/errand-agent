import { EMPTY_DETAILS, patchDetails, type Errand, type ErrandField, type ErrandPatch } from "../errand/errand";
import type { ErrandHandoff, MovedHandoff } from "../errand/errand-handoff";
import { isEditable, type TracePlace } from "../errand/errand-workflow";
import type { ErrandHandoffStore } from "../ports/errand-handoff-store";
import type { DateRange } from "../ports/provider-world";
import type { ServiceCatalog } from "../ports/service-catalog";
import type { RecordedSearch, SessionToolCalls } from "../ports/session-tool-calls";
import type { TraceEvent } from "../ports/trace-sink";
import type { ErrandDependencies } from "./errand-session";
import { updateErrand } from "./update-errand";

// "Start in a new chat" on a New errand card: the job a booked chat couldn't take moves to a new
// chat. The new chat's errand starts from the refused search's service, area and dates, saved
// before its first model turn (as the home composer's chips are), so the agent asks for none of
// them. The service goes in too: the person's words may only say "what about my mom's place in
// HSR", and the new chat sees nothing of the old one. Nothing is booked, held or paid, so no
// approval is needed. The card is settled once, here or by "Not now" (dismissNewErrand).

export interface NewErrandSearch {
  /** The refused search's arguments, still in the model's words. */
  readonly service: string;
  readonly area: string;
  readonly dates: DateRange;
}

export type StartNewErrandOutcome =
  | { readonly kind: "moved"; readonly handoff: MovedHandoff; readonly errand?: Errand }
  /** The card was settled before: moved (its chat is the answer) or dismissed. */
  | { readonly kind: "already_settled"; readonly handoff: ErrandHandoff }
  /** The chat's own errand can still change, so the job belongs in it. */
  | { readonly kind: "still_editable" }
  | { readonly kind: "same_session" }
  | CardRefusal
  /** The chat to move to already has an errand (or a moved job); only a fresh chat can take the job. */
  | { readonly kind: "errand_exists" };

/**
 * The card names a tool call by id and repeats its arguments. Both come from the client, so they are
 * checked against the session's own record before anything is drafted or settled.
 */
export type CardRefusal =
  /** The session made no search_providers call with that id: a forged or mistyped card. */
  | { readonly kind: "unknown_card" }
  /** The call exists but wasn't refused as not editable, so there is no card for it. */
  | { readonly kind: "not_refused" }
  /** The card's arguments aren't the call's: the client changed the job. */
  | { readonly kind: "search_mismatch" };

export interface CardDependencies {
  readonly handoffs: ErrandHandoffStore;
  readonly toolCalls: SessionToolCalls;
}

export interface NewErrandDependencies extends ErrandDependencies, CardDependencies {}

function isSameSearch(recorded: RecordedSearch, sent: NewErrandSearch): boolean {
  return (
    recorded.service === sent.service &&
    recorded.area === sent.area &&
    recorded.dates.from === sent.dates.from &&
    recorded.dates.to === sent.dates.to
  );
}

/** The card's search as the session recorded it, or why there is no such card. */
export async function checkCard(
  toolCalls: SessionToolCalls,
  card: { readonly fromSessionId: string; readonly toolCallId: string; readonly search?: NewErrandSearch },
): Promise<CardRefusal | { readonly kind: "card"; readonly search: RecordedSearch }> {
  const recorded = await toolCalls.searchCall(card.fromSessionId, card.toolCallId);
  if (recorded === undefined) return { kind: "unknown_card" };
  if (recorded.outcome !== "not_editable") return { kind: "not_refused" };
  if (card.search !== undefined && !isSameSearch(recorded, card.search)) return { kind: "search_mismatch" };
  return { kind: "card", search: recorded };
}

/**
 * The search's fields the catalog knows, in its terms. One the catalog doesn't know is left for the
 * new chat to ask about, rather than refusing the move: the card must always work.
 */
function patchOf(search: NewErrandSearch, catalog: ServiceCatalog): ErrandPatch {
  const service = catalog.resolveService(search.service);
  const area = catalog.resolveArea(search.area);
  const timeWindow = { dates: search.dates };
  const datesFit = patchDetails(EMPTY_DETAILS, { timeWindow }).kind === "patched";
  return {
    ...(service === undefined ? {} : { service }),
    ...(area === undefined ? {} : { area }),
    ...(datesFit ? { timeWindow } : {}),
  };
}

function handedOffEvent(errand: Errand, changed: readonly ErrandField[], handoff: MovedHandoff, place: TracePlace, atMs: number): TraceEvent {
  return {
    type: "event",
    traceId: place.traceId,
    eventId: `${errand.errandId}:handoff-draft`,
    sessionId: place.sessionId,
    kind: "errand_drafted",
    name: `new errand card → errand: ${changed.join(", ")}`,
    timeMs: atMs,
    attributes: {
      "errand.id": errand.errandId,
      "errand.handoff.from_session": handoff.fromSessionId,
      "errand.handoff.tool_call": handoff.toolCallId,
      "errand.handoff.fields": [...changed],
    },
  };
}

async function settledCard(handoffs: ErrandHandoffStore, fromSessionId: string, toolCallId: string): Promise<ErrandHandoff | undefined> {
  return (await handoffs.settledIn(fromSessionId)).find((handoff) => handoff.toolCallId === toolCallId);
}

export async function startNewErrand(
  deps: NewErrandDependencies,
  request: {
    readonly fromSessionId: string;
    readonly toolCallId: string;
    /** The new chat; its trace gets the draft. */
    readonly place: TracePlace;
    readonly search: NewErrandSearch;
  },
): Promise<StartNewErrandOutcome> {
  const { fromSessionId, toolCallId, place } = request;
  if (place.sessionId === fromSessionId) return { kind: "same_session" };
  const card = await checkCard(deps.toolCalls, { fromSessionId, toolCallId, search: request.search });
  if (card.kind !== "card") return card;
  const earlier = await settledCard(deps.handoffs, fromSessionId, toolCallId);
  if (earlier !== undefined) return { kind: "already_settled", handoff: earlier };
  // After a restart the old errand is gone (errands live in memory); the card itself is the proof
  // that the chat's errand was booked when it was refused.
  const old = await deps.errands.find(fromSessionId);
  if (old !== undefined && isEditable(old.state)) return { kind: "still_editable" };
  const taken = (await deps.errands.find(place.sessionId)) ?? (await deps.handoffs.startedIn(place.sessionId));
  if (taken !== undefined) return { kind: "errand_exists" };

  const candidate: MovedHandoff = {
    kind: "moved",
    fromSessionId,
    toolCallId,
    toSessionId: place.sessionId,
    settledAtMs: deps.clock.now().getTime(),
    origin: {
      ...(old?.details.service === undefined ? {} : { service: old.details.service }),
      ...(old?.details.area === undefined ? {} : { area: old.details.area }),
    },
  };
  // Settled before the draft: of two taps racing with two new chats, only the winner's is drafted.
  const handoff = await deps.handoffs.settle(candidate);
  if (handoff.kind !== "moved" || handoff.toSessionId !== place.sessionId) return { kind: "already_settled", handoff };

  // Drafted from the session's record of the search, never from what the client sent.
  const patch = patchOf(card.search, deps.catalog);
  if (Object.keys(patch).length === 0) return { kind: "moved", handoff };
  const drafted = await updateErrand(deps, { place, patch });
  // The patch is in the catalog's terms and the errand is new, so only "updated" can come back.
  if (drafted.kind !== "updated") throw new Error(`Drafting the moved errand returned ${drafted.kind}.`);
  await deps.traceSink.record(handedOffEvent(drafted.errand, drafted.changed, handoff, place, deps.clock.now().getTime()));
  return { kind: "moved", handoff, errand: drafted.errand };
}
