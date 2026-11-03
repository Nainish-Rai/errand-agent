import { equals } from "eve/evals/expect";

import { bookingChanges } from "../../approval-checks";
import { ASK_FOR_PLUMBER, CHOOSE_CHEAPEST, executeTurn, FIRST_BOOKING_ID, HOLD_AND_PROPOSE_TURN, SEARCH_TURN } from "../../booking-conversation";
import { bookingTrace, sessionIntents } from "../../ledger-checks";
import { defineScenario } from "../../scenario";

// Ticket 07, "timeout after success (booked)". `book` times out, but the provider did book. Core
// asks get_booking_status with the same key before anything else, finds the booking, and reports
// it: no retry, one booking, and the ledger's intent confirmed after one attempt.

export default defineScenario({
  id: "scenarios/booking/timeout-after-success-booked",
  description: "book times out after the provider booked: the status check finds the booking, nothing is retried, one booking exists.",
  world: { scenario: "timeout_after_success", seed: 42 },
  user: [{ say: ASK_FOR_PLUMBER }, { say: CHOOSE_CHEAPEST }, { card: "approve" }],
  goal:
    "You want a plumber in Koramangala this week. When you see the options, ask for the cheapest one. " +
    "When the approval card appears, tap Approve on it. Once the assistant tells you the outcome, you are done.",
  maxSimulatedMessages: 4,
  model: {
    turns: [SEARCH_TURN, HOLD_AND_PROPOSE_TURN, executeTurn(`Booked: Shiva Sanitary Solutions, Thu 5 Nov at 8:00 am IST, ₹399. Booking ID ${FIRST_BOOKING_ID}.`)],
  },
  expected:
    "book → timeout, then get_booking_status → booked with the same key; no second book; execute_proposal says booked; exactly one booking; the intent is confirmed after 1 attempt",
  actual(run) {
    const outputs = run.toolCalls.filter((call) => call.name === "execute_proposal").map((call) => (call.output as { kind?: string } | undefined)?.kind);
    return `execute_proposal → ${outputs.join(", ") || "none"}`;
  },
  async expect(t, run) {
    t.succeeded();
    const { made } = await bookingChanges(run);
    t.check(made.length, equals(1)).label("exactly one booking");

    const trace = await bookingTrace(run.operatorApi, run.sessionId);
    t.check(trace.worldCalls, equals(["book timeout", "get_booking_status booked"])).label("the status is checked, and nothing is retried");
    t.check(trace.retries, equals(0)).label("no retry");
    t.check(trace.ledger, equals(["recorded → pending", "pending → pending", "pending → unknown", "unknown → confirmed"])).label("the ledger's transitions are traced");

    const intents = await sessionIntents(run.api, run.sessionId);
    await t.require(intents.length, equals(1));
    const [intent] = intents;
    t.check([intent?.state, intent?.attempts, intent?.resolvedBy], equals(["confirmed", 1, "execution"]));
    t.check(intent?.bookingId, equals(made[0]?.bookingId)).label("the ledger names the world's booking");
    t.check(trace.bookKeys, equals([intent?.idempotencyKey])).label("book used the grant's key");

    const [proposal] = await run.api.listSessionProposals(run.sessionId);
    t.check(proposal?.status, equals("executed"));
    t.check((await run.api.getErrand(run.sessionId))?.state, equals("done"));
  },
});
