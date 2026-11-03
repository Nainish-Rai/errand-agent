import { equals } from "eve/evals/expect";

import { bookingChanges, executionsIn } from "../../approval-checks";
import { ASK_FOR_PLUMBER, CHOOSE_CHEAPEST, executeTurn, FIRST_BOOKING_ID, HOLD_AND_PROPOSE_TURN, SEARCH_TURN } from "../../booking-conversation";
import { bookingTrace, sessionIntents } from "../../ledger-checks";
import { defineScenario } from "../../scenario";

// Ticket 07, "repeated confirmation". The person taps Approve twice and then says yes twice. Every
// one of them reaches execute_proposal, and still one booking exists: the grant is used once, the
// ledger holds one intent for it, and `book` is sent once.

const BOOKED = `Booked: Shiva Sanitary Solutions, Thu 5 Nov at 8:00 am IST, ₹399. Booking ID ${FIRST_BOOKING_ID}.`;

export default defineScenario({
  id: "scenarios/booking/repeated-confirmation",
  description: "Two taps on Approve and two typed yeses still make exactly one booking.",
  world: { scenario: "happy_path", seed: 42 },
  user: [{ say: ASK_FOR_PLUMBER }, { say: CHOOSE_CHEAPEST }, { card: "approve" }, { card: "approve" }, { say: "Yes, go ahead." }, { say: "Yes!" }],
  goal:
    "You want a plumber in Koramangala this week. When you see the options, ask for the cheapest one. " +
    "When the approval card appears, tap Approve on it twice, then say yes in the chat twice. Then you are done.",
  maxSimulatedMessages: 6,
  model: {
    turns: [SEARCH_TURN, HOLD_AND_PROPOSE_TURN, executeTurn(BOOKED), executeTurn(BOOKED), executeTurn(BOOKED), executeTurn(BOOKED)],
  },
  expected:
    "both Approve taps get 200 with the same grant; four execute_proposal calls: booked, then already_booked three times, all with the same booking ID; exactly one booking; one intent; book sent once",
  actual(run) {
    const outputs = run.toolCalls.filter((call) => call.name === "execute_proposal").map((call) => (call.output as { kind?: string } | undefined)?.kind);
    return `taps ${run.taps.map((tap) => tap.status).join(", ")}; execute_proposal → ${outputs.join(", ") || "none"}`;
  },
  async expect(t, run) {
    t.succeeded();
    t.check(run.taps.map((tap) => `${tap.tap} ${tap.status}`), equals(["approve 200", "approve 200"])).label("both taps reach the API");

    const executions = run.turns.flatMap((turn) => executionsIn(turn));
    t.check(executions.map((output) => output.kind), equals(["booked", "already_booked", "already_booked", "already_booked"]));
    const ids = new Set(executions.map((output) => output.bookingId));
    t.check(ids.size, equals(1)).label("every confirmation names the same booking");

    const { made } = await bookingChanges(run);
    t.check(made.length, equals(1)).label("exactly one booking");
    const intents = await sessionIntents(run.api, run.sessionId);
    t.check(intents.map((intent) => [intent.state, intent.attempts]), equals([["confirmed", 1]])).label("one intent, one attempt");
    const trace = await bookingTrace(run.api, run.sessionId);
    t.check(trace.bookKeys.length, equals(1)).label("book is sent once");
  },
});
