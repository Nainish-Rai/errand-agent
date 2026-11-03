import type { ApiClient } from "@errand/client";
import type { ActionIntentView } from "@errand/contracts";

import { settledTrace } from "./session-trace";

// What the exactly-once scenarios read back: the session's action-ledger intents, and the world
// calls and ledger transitions core traced while booking.

export async function sessionIntents(api: ApiClient, sessionId: string): Promise<readonly ActionIntentView[]> {
  return api.listSessionActionIntents(sessionId);
}

export interface BookingTrace {
  /** `book timeout`, `get_booking_status booked`, ... in the order core made them. */
  readonly worldCalls: readonly string[];
  /** The idempotency key each `book` call sent, in order. */
  readonly bookKeys: readonly string[];
  /** `recorded → pending`, `pending → confirmed`, ... */
  readonly ledger: readonly string[];
  /** World calls the trace marks as a retry (`errand.retry`). */
  readonly retries: number;
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function resultKind(value: unknown): string {
  return typeof value === "object" && value !== null && "kind" in value ? text(value.kind) : "";
}

export async function bookingTrace(api: ApiClient, sessionId: string): Promise<BookingTrace> {
  const trace = await settledTrace(api, sessionId);
  const calls = trace.spans.filter((span) => span.attributes["errand.world.call"] === true);
  const callName = (span: (typeof calls)[number]) => text(span.attributes["gen_ai.tool.name"]);
  return {
    worldCalls: calls.map((span) => `${callName(span)} ${resultKind(span.attributes["gen_ai.tool.call.result"])}`.trim()),
    bookKeys: calls.filter((span) => callName(span) === "book").map((span) => text(span.attributes["errand.ledger.key"])),
    ledger: trace.events.filter((event) => event.kind === "ledger_transition").map((event) => event.name.replace(/^ledger /, "")),
    retries: calls.filter((span) => span.attributes["errand.retry"] === true).length,
  };
}
