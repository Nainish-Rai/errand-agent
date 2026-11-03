import { equals } from "eve/evals/expect";

import { bookingChanges } from "../../approval-checks";
import { ASK_FOR_PLUMBER, CHOOSE_CHEAPEST, executeTurn, FIRST_BOOKING_ID, HOLD_AND_PROPOSE_TURN, SEARCH_TURN } from "../../booking-conversation";
import { bookingTrace, sessionIntents } from "../../ledger-checks";
import { defineScenario } from "../../scenario";

// Ticket 07, "timeout after success (not booked)". `book` times out and the provider booked
// nothing. The status check says so, and core sends `book` again with the same key, which books.
// One booking, two attempts, and the trace marks the second call as a retry.

export default defineScenario({
  id: "scenarios/booking/timeout-after-success-not-booked",
  description: "book times out and nothing was booked: the status check says so, the retry uses the same key, one booking exists.",
  world: { scenario: "timeout_without_booking", seed: 42 },
  user: [{ say: ASK_FOR_PLUMBER }, { say: CHOOSE_CHEAPEST }, { card: "approve" }],
  goal:
    "You want a plumber in Koramangala this week. When you see the options, ask for the cheapest one. " +
    "When the approval card appears, tap Approve on it. Once the assistant tells you the outcome, you are done.",
  maxSimulatedMessages: 4,
  model: {
    turns: [SEARCH_TURN, HOLD_AND_PROPOSE_TURN, executeTurn(`Booked: Shiva Sanitary Solutions, Thu 5 Nov at 8:00 am IST, ₹399. Booking ID ${FIRST_BOOKING_ID}.`)],
  },
  expected:
    "book → timeout, get_booking_status → not_found, book again with the same key → booked, get_booking_status → booked; exactly one booking; the intent is confirmed after 2 attempts",
  actual(run) {
    const outputs = run.toolCalls.filter((call) => call.name === "execute_proposal").map((call) => (call.output as { kind?: string } | undefined)?.kind);
    return `execute_proposal → ${outputs.join(", ") || "none"}`;
  },
  async expect(t, run) {
    t.succeeded();
    const { made } = await bookingChanges(run);
    t.check(made.length, equals(1)).label("exactly one booking");

    const intents = await sessionIntents(run.api, run.sessionId);
    await t.require(intents.length, equals(1));
    const [intent] = intents;
    t.check([intent?.state, intent?.attempts, intent?.resolvedBy], equals(["confirmed", 2, "execution"]));
    t.check(intent?.bookingId, equals(made[0]?.bookingId)).label("the ledger names the world's booking");

    const trace = await bookingTrace(run.operatorApi, run.sessionId);
    t.check(trace.worldCalls.slice(0, 3), equals(["book timeout", "get_booking_status not_found", "book booked"])).label(
      "the status is checked before the retry",
    );
    t.check(trace.bookKeys, equals([intent?.idempotencyKey, intent?.idempotencyKey])).label("the retry uses the same key");
    t.check(trace.retries, equals(1)).label("the trace marks the retry");
    t.check(trace.ledger.at(-1), equals("pending → confirmed"));

    const [proposal] = await run.api.listSessionProposals(run.sessionId);
    t.check(proposal?.status, equals("executed"));
  },
});
