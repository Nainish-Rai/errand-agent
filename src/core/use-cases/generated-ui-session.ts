import type { TracePlace } from "../errand/errand-workflow";
import { bookingIdsIn, providerIdsIn, type GeneratedUiVerdict, type UiProblem } from "../generated-ui/generated-ui";
import type { Clock } from "../ports/clock";
import type { ErrandStore } from "../ports/errand-store";
import type { GeneratedUiReader, GeneratedUiReading } from "../ports/generated-ui-reader";
import type { ProviderWorld } from "../ports/provider-world";
import type { TraceSink, TraceValue } from "../ports/trace-sink";

// What the present and ask use cases share: the reader, the world that confirms every id, and the
// trace each judgement is written to (with the parse errors, when the program didn't parse).

export interface GeneratedUiDependencies {
  readonly reader: GeneratedUiReader;
  readonly world: ProviderWorld;
  readonly errands: ErrandStore;
  readonly traceSink: TraceSink;
  readonly clock: Clock;
}

export interface GeneratedUiRequest {
  readonly place: TracePlace;
  /** The person the chat is for, whose bookings a booking id must name. */
  readonly userId: string;
  readonly program: string;
}

/** The ids the program names that the world doesn't have, as problems. */
export async function unknownIdsIn(deps: GeneratedUiDependencies, reading: GeneratedUiReading, userId: string): Promise<UiProblem[]> {
  if (reading.kind === "unreadable") return [];
  const providers = await Promise.all(
    providerIdsIn(reading.nodes).map(async (providerId) => ({ providerId, found: (await deps.world.getProvider(providerId)).kind === "found" })),
  );
  const bookingIds = bookingIdsIn(reading.nodes);
  const owned = bookingIds.length === 0 ? new Set<string>() : new Set((await deps.world.listBookings(userId)).map((booking) => booking.bookingId));
  return [
    ...providers.filter((provider) => !provider.found).map(({ providerId }): UiProblem => ({ kind: "unknown_provider", providerId })),
    ...bookingIds.filter((bookingId) => !owned.has(bookingId)).map((bookingId): UiProblem => ({ kind: "unknown_booking", bookingId })),
  ];
}

export function problemText(problem: UiProblem): string {
  switch (problem.kind) {
    case "unknown_component":
      return `unknown component ${problem.component}`;
    case "pending_component":
      return `${problem.component} waits on ticket ${problem.pendingOn}`;
    case "action_not_allowed":
      return `action not allowed: ${problem.what}`;
    case "commit_phrase":
      return `${problem.component} offers "${problem.text}"`;
    case "ask_in_present":
      return `${problem.component} asks, so it belongs in ask_ui`;
    case "nothing_to_ask":
      return "nothing to ask";
    case "asks_known_field":
      return `asks for ${problem.field}, which the errand already has`;
    case "unknown_provider":
      return `unknown provider ${problem.providerId}`;
    case "unknown_booking":
      return `unknown booking ${problem.bookingId}`;
  }
}

function verdictAttributes(verdict: GeneratedUiVerdict): Record<string, TraceValue> {
  switch (verdict.kind) {
    case "drawable":
      return { "errand.ui.components": [...verdict.components], "errand.ui.warnings": [...verdict.warnings] };
    case "unreadable":
      return { "errand.ui.errors": [...verdict.errors] };
    case "refused":
      return { "errand.ui.problems": verdict.problems.map(problemText) };
  }
}

/** One `generated_ui` event on the tool call's span: which surface, the verdict, and why. */
export async function traceVerdict(
  deps: GeneratedUiDependencies,
  place: TracePlace,
  surface: "present" | "ask",
  verdict: GeneratedUiVerdict,
): Promise<void> {
  const timeMs = deps.clock.now().getTime();
  await deps.traceSink.record({
    type: "event",
    traceId: place.traceId,
    eventId: `${place.spanId ?? place.sessionId}:generated_ui`,
    sessionId: place.sessionId,
    ...(place.spanId === undefined ? {} : { spanId: place.spanId }),
    kind: "generated_ui",
    name: `${surface}: ${verdict.kind}`,
    timeMs,
    attributes: { "errand.ui.surface": surface, "errand.ui.verdict": verdict.kind, ...verdictAttributes(verdict) },
  });
}

