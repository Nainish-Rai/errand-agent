import {
  attemptStarted,
  confirmedAs,
  failedWith,
  isResolved,
  ledgerEvent,
  unknownAfterTimeout,
  type ActionIntent,
  type ResolvedBy,
} from "../booking/action-intent";
import { readBookReply, settleFromStatus, type Settlement } from "../booking/reconciliation";
import type { TracePlace } from "../errand/errand-workflow";
import type { ActionLedger } from "../ports/action-ledger";
import type { Clock } from "../ports/clock";
import type { BookingStatusOutcome, BookOutcome, ProviderWorld } from "../ports/provider-world";
import type { TraceAttributes, TraceSink, TraceValue } from "../ports/trace-sink";

// Drives one action intent as far as the world lets it go: confirmed, failed, or still unknown.
// The execution that wrote the intent calls it right after recording it; the reconciler calls it
// for every intent left pending or unknown (a timeout, a run cut off at its deadline, a crash).
//
// Every attempt is counted in the ledger before `book` is sent, so after a crash the ledger says
// a call may have landed. And before `book` is sent again, the status is read with the same key,
// so a booking that landed is found instead of being made twice; the world's idempotency makes a
// repeated key harmless even when two callers race.

export interface LedgerDependencies {
  readonly world: ProviderWorld;
  readonly ledger: ActionLedger;
  readonly traceSink: TraceSink;
  /** Stamps the ledger and the trace: the wall clock, like every span. */
  readonly clock: Clock;
  /** The world's time, which holds expire by. It differs from `clock` when the evals pin the date. */
  readonly worldClock: Clock;
}

export interface SettleActionIntentRequest {
  readonly intent: ActionIntent;
  readonly place: TracePlace;
  readonly by: ResolvedBy;
}

type WorldCall = "book" | "get_booking_status";

interface Step {
  intent: ActionIntent;
  readonly deps: LedgerDependencies;
  readonly request: SettleActionIntentRequest;
  calls: number;
}

function nowMs(deps: LedgerDependencies): number {
  return deps.clock.now().getTime();
}

/** The world call as an `execute_tool` span under the tool call, the shape the observatory reads retries from. */
async function traced<T extends BookOutcome | BookingStatusOutcome>(
  step: Step,
  call: WorldCall,
  args: Record<string, string>,
  run: () => Promise<T>,
): Promise<T> {
  const { deps, request, intent } = step;
  step.calls += 1;
  const startTimeMs = nowMs(deps);
  const spanId = `world:${intent.idempotencyKey}:${call}:${startTimeMs}:${step.calls}`;
  const retry = call === "book" && intent.attempts > 1;
  const attributes: TraceAttributes = {
    "gen_ai.operation.name": "execute_tool",
    "gen_ai.tool.name": call,
    "gen_ai.tool.call.id": spanId,
    "gen_ai.tool.type": "function",
    "gen_ai.tool.call.arguments": args,
    "errand.tool.framework": false,
    "errand.world.call": true,
    "errand.ledger.key": intent.idempotencyKey,
    "errand.ledger.attempt": intent.attempts,
    "errand.retry": retry,
    "errand.ledger.resolved_by": request.by,
  };
  const base = {
    type: "span" as const,
    traceId: request.place.traceId,
    spanId,
    ...(request.place.spanId === undefined ? {} : { parentSpanId: request.place.spanId }),
    sessionId: request.place.sessionId,
    kind: "tool" as const,
    name: `execute_tool ${call}`,
    startTimeMs,
  };
  await deps.traceSink.record({ ...base, status: "running", attributes });
  const end = (status: "ok" | "error", extra: Record<string, TraceValue>) => {
    const endTimeMs = Math.max(startTimeMs, nowMs(deps));
    return deps.traceSink.record({ ...base, status, endTimeMs, durationMs: endTimeMs - startTimeMs, attributes: { ...attributes, ...extra } });
  };
  try {
    const result = await run();
    const timedOut = result.kind === "timeout";
    await end(timedOut ? "error" : "ok", {
      "gen_ai.tool.call.result": { ...result },
      "errand.tool.outcome": timedOut ? "failed" : "completed",
      ...(timedOut ? { "error.type": "timeout", "errand.error.message": "the provider did not answer in time" } : {}),
    });
    return result;
  } catch (error) {
    await end("error", {
      "errand.tool.outcome": "failed",
      "error.type": error instanceof Error ? error.name : "Error",
      "errand.error.message": error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/** Saves the change over the version it was made from and traces it. False when someone else changed the intent first. */
async function advanced(step: Step, next: ActionIntent): Promise<boolean> {
  if (!(await step.deps.ledger.advance(next))) return false;
  await step.deps.traceSink.record(ledgerEvent(step.intent, next, step.request.place));
  step.intent = next;
  return true;
}

/** What the ledger holds now, after another writer got there first. */
async function reread(step: Step): Promise<ActionIntent> {
  const stored = await step.deps.ledger.find(step.intent.idempotencyKey);
  if (stored === undefined) throw new Error(`Intent ${step.intent.idempotencyKey} vanished from the ledger.`);
  step.intent = stored;
  return stored;
}

function readStatus(step: Step): Promise<BookingStatusOutcome> {
  const key = step.intent.idempotencyKey;
  return traced(step, "get_booking_status", { idempotency_key: key }, () => step.deps.world.getBookingStatus(key));
}

/** Counts the attempt, sends `book` with the intent's key, and settles from the status (never from the reply alone). */
async function attempt(step: Step): Promise<Settlement | "taken_over"> {
  if (!(await advanced(step, attemptStarted(step.intent, nowMs(step.deps))))) return "taken_over";
  const { holdId, idempotencyKey } = step.intent;
  const reply = await traced(step, "book", { hold_id: holdId, idempotency_key: idempotencyKey }, () =>
    step.deps.world.book(holdId, idempotencyKey),
  );
  // A timeout says nothing about whether it booked: the intent is unknown until the status says,
  // which is what the chat shows as "Checking with the provider…".
  if (reply.kind === "timeout" && !(await advanced(step, unknownAfterTimeout(step.intent, nowMs(step.deps))))) return "taken_over";
  const reading = readBookReply(reply);
  if (reading.kind === "fail") return reading;
  // UCP's rule for an ambiguous call: re-check the status with the same key before anything else.
  const status = await readStatus(step);
  return settleFromStatus(step.intent, status, { worldNowMs: step.deps.worldClock.now().getTime(), reply });
}

function resolution(intent: ActionIntent, settlement: Settlement, by: ResolvedBy, atMs: number): ActionIntent | undefined {
  switch (settlement.kind) {
    case "confirm":
      return confirmedAs(intent, settlement.bookingId, by, atMs);
    case "fail":
      return failedWith(intent, settlement.reason, by, atMs);
    case "unknown":
    case "retry":
      // Already unknown, or still pending because another writer's call is in flight: nothing to record.
      return intent.state === "pending" && intent.attempts > 0 ? unknownAfterTimeout(intent, atMs) : undefined;
  }
}

/** Records the settlement. The world's answer is the truth, so a confirmation or a failure wins over any unresolved state. */
async function recorded(step: Step, settlement: Settlement): Promise<ActionIntent> {
  for (;;) {
    if (isResolved(step.intent)) return step.intent;
    const next = resolution(step.intent, settlement, step.request.by, nowMs(step.deps));
    if (next === undefined || (await advanced(step, next))) return step.intent;
    const stored = await reread(step);
    // Someone else counted a newer attempt; their call decides an unknown outcome.
    if (settlement.kind === "unknown" || settlement.kind === "retry") return stored;
  }
}

export async function settleActionIntent(deps: LedgerDependencies, request: SettleActionIntentRequest): Promise<ActionIntent> {
  const step: Step = { intent: request.intent, deps, request, calls: 0 };
  if (isResolved(step.intent)) return step.intent;

  // A `book` may already have been sent (by a run that timed out, was cut off, or crashed): ask
  // the world before sending anything.
  let settlement: Settlement =
    step.intent.attempts > 0
      ? settleFromStatus(step.intent, await readStatus(step), { worldNowMs: deps.worldClock.now().getTime() })
      : { kind: "retry" };

  while (settlement.kind === "retry") {
    if (step.intent.state === "pending" && step.intent.attempts > 0) {
      // The timeout is on record before the retry, so the trace shows pending → unknown → pending.
      if (!(await advanced(step, unknownAfterTimeout(step.intent, nowMs(deps))))) return reread(step);
    }
    const next = await attempt(step);
    if (next === "taken_over") return reread(step);
    settlement = next;
  }
  return recorded(step, settlement);
}
