import type { ErrandHandoffView, GetErrandHandoffsResponse, HandoffOriginView } from "@errand/contracts";

import type { Errand } from "../../src/core/errand/errand";
import type { ErrandHandoff, MovedHandoff } from "../../src/core/errand/errand-handoff";
import type { ErrandHandoffs } from "../../src/core/use-cases/list-errand-handoffs";
import type { CardRefusal, StartNewErrandOutcome } from "../../src/core/use-cases/start-new-errand";

// New errand cards (ticket 24): core's hand-offs to the wire, and one message per refusal.

function isoOf(atMs: number): string {
  return new Date(atMs).toISOString();
}

export function presentHandoff(handoff: ErrandHandoff): ErrandHandoffView {
  return handoff.kind === "moved"
    ? { kind: "moved", toolCallId: handoff.toolCallId, toSessionId: handoff.toSessionId, at: isoOf(handoff.settledAtMs) }
    : { kind: "dismissed", toolCallId: handoff.toolCallId, at: isoOf(handoff.settledAtMs) };
}

function presentOrigin(handoff: MovedHandoff): HandoffOriginView {
  return {
    sessionId: handoff.fromSessionId,
    service: handoff.origin.service ?? null,
    area: handoff.origin.area ?? null,
    at: isoOf(handoff.settledAtMs),
  };
}

export function presentHandoffs(handoffs: ErrandHandoffs): GetErrandHandoffsResponse {
  return {
    settled: handoffs.settled.map(presentHandoff),
    startedFrom: handoffs.startedFrom === undefined ? null : presentOrigin(handoffs.startedFrom),
  };
}

/** A card the session's own record doesn't back: forged, not a refused search, or edited. */
export function presentCardRefusal(outcome: CardRefusal): { readonly status: number; readonly code: string; readonly message: string } {
  switch (outcome.kind) {
    case "unknown_card":
      return { status: 404, code: "unknown_card", message: "This chat has no New errand card with that id." };
    case "not_refused":
      return { status: 409, code: "not_refused", message: "That search wasn't refused, so there is no New errand card for it." };
    case "search_mismatch":
      return { status: 422, code: "search_mismatch", message: "The card's details don't match the search this chat made." };
  }
}

/**
 * What the app API answers when a job doesn't move. The route answers a card moved earlier with its
 * chat, so the only settled card that gets here is a dismissed one.
 */
export function presentStartRefusal(
  outcome: Exclude<StartNewErrandOutcome, { readonly kind: "moved" }>,
): { readonly status: number; readonly code: string; readonly message: string } {
  switch (outcome.kind) {
    case "already_settled":
      return { status: 409, code: "card_dismissed", message: "You dismissed this card. Ask again to start the new errand." };
    case "still_editable":
      return { status: 409, code: "errand_editable", message: "This chat's errand isn't booked yet, so it can take the new job here." };
    case "same_session":
      return { status: 422, code: "same_session", message: "Start the new errand in a new chat." };
    case "errand_exists":
      return { status: 409, code: "errand_exists", message: "That chat already has an errand. Start the new errand in a new chat." };
    case "unknown_card":
    case "not_refused":
    case "search_mismatch":
      return presentCardRefusal(outcome);
  }
}

/**
 * For a chat started from a New errand card, while its errand is still being gathered: what the
 * errand already holds, so the first turn asks for none of it. Built from the errand, never from
 * the old chat's text.
 */
export function presentMovedErrandInstructions(errand: Errand): string | undefined {
  if (errand.state !== "gathering") return undefined;
  const { service, area, timeWindow } = errand.details;
  const known = [
    service === undefined ? undefined : `service "${service}"`,
    area === undefined ? undefined : `area "${area}"`,
    timeWindow === undefined ? undefined : `dates ${timeWindow.dates.from} to ${timeWindow.dates.to}`,
  ].filter((part): part is string => part !== undefined);
  if (known.length === 0) return undefined;
  return (
    "This chat was started from the person's earlier chat to take a new errand; their message is the request they made there. " +
    `The errand already holds ${known.join(", ")}. Never ask for these. Call update_errand only with what their message adds or changes, ` +
    "and when nothing is missing, search_providers straight away."
  );
}
