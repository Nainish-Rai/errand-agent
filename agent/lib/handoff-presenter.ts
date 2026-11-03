import type { ErrandHandoffView, GetErrandHandoffsResponse, HandoffOriginView } from "@errand/contracts";

import type { ErrandHandoff, MovedHandoff } from "../../src/core/errand/errand-handoff";
import type { ErrandHandoffs } from "../../src/core/use-cases/list-errand-handoffs";
import type { StartNewErrandOutcome } from "../../src/core/use-cases/start-new-errand";

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
  }
}
