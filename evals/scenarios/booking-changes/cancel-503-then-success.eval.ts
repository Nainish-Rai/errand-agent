import { equals } from "eve/evals/expect";

import { bookingChanges, cardsIn, executionsIn } from "../../approval-checks";
import { AC_BOOKING, acBookingNow } from "../../booking-change-conversation";
import { executeTurn } from "../../booking-conversation";
import { bookingTrace, sessionIntents } from "../../ledger-checks";
import { defineScenario } from "../../scenario";

// Ticket 10, "cancel 503 then success". The cancellation card shows the fee (none, five days ahead).
// After the tap, the provider's first cancel answers 503; core reads the booking (still upcoming),
// retries with the same key, and says "cancelled" only once the booking's status shows it.

export default defineScenario({
  id: "scenarios/booking-changes/cancel-503-then-success",
  description: "A 503 on cancel is retried with the same key; one cancellation, claimed only after the status check.",
  world: { scenario: "happy_path", seed: 42 },
  user: [{ say: "Cancel my AC servicing booking" }, { card: "approve" }],
  goal:
    "You have an AC servicing visit booked and want to cancel it. Your first message says exactly that. When the " +
    "cancellation card appears, tap Approve on it. Once the assistant tells you the outcome, you are done.",
  maxSimulatedMessages: 3,
  model: {
    turns: [
      {
        steps: [
          { toolCalls: [{ name: "list_bookings", input: {} }] },
          {
            toolCalls: [
              {
                name: "propose_action",
                input: { action: "cancel", booking_id: AC_BOOKING.bookingId },
              },
            ],
          },
          {
            text: "Your AC service with Ravi Aircon Experts on Mon 9 Nov at 11:00 am can be cancelled free. Tap Approve on the card to cancel it.",
          },
        ],
      },
      executeTurn(`Cancelled: Ravi Aircon Experts, Mon 9 Nov at 11:00 am, no fee. Booking ID ${AC_BOOKING.bookingId}.`),
    ],
  },
  expected:
    "the card shows the booking and its fee (none); after the tap: cancel → service_unavailable, list_bookings → upcoming, cancel again with the same key → cancelled, list_bookings → cancelled; one cancellation; Cancelled only after that",
  actual(run) {
    const outputs = run.toolCalls.filter((call) => call.name === "execute_proposal").map((call) => (call.output as { kind?: string } | undefined)?.kind);
    return `execute_proposal → ${outputs.join(", ") || "none"}`;
  },
  async expect(t, run) {
    t.succeeded();
    await t.require(
      run.taps.map((tap) => `${tap.tap} ${tap.status}`),
      equals(["approve 200"]),
    );
    const card = run.turns.flatMap((turn) => cardsIn(turn)).at(-1);
    await t.require(card?.terms.action, equals("cancel"));
    t.check([card?.terms.slot.start, card?.terms.priceInr], equals([AC_BOOKING.slot.start, 0])).label("the card shows the booking and its fee");

    const trace = await bookingTrace(run.operatorApi, run.sessionId);
    t.check(trace.worldCalls, equals(["cancel service_unavailable", "list_bookings upcoming", "cancel cancelled", "list_bookings cancelled"])).label(
      "the 503 is retried after a status read, and the success is read back",
    );
    const intents = await sessionIntents(run.api, run.sessionId);
    await t.require(intents.length, equals(1));
    const [intent] = intents;
    t.check(trace.changeKeys, equals([intent?.idempotencyKey, intent?.idempotencyKey])).label("the retry uses the same key");
    t.check(trace.retries, equals(1)).label("the trace marks the retry");
    t.check([intent?.action, intent?.state, intent?.attempts, intent?.targetBookingId], equals(["cancel", "confirmed", 2, AC_BOOKING.bookingId]));

    const { made, altered } = await bookingChanges(run);
    t.check(made.length, equals(0));
    t.check(
      altered.map((booking) => [booking.bookingId, booking.status]),
      equals([[AC_BOOKING.bookingId, "cancelled"]]),
    ).label("exactly one cancellation");
    const booking = await acBookingNow(run.api);
    t.check(
      booking?.changes.map((change) => [change.action, change.status, change.grantConsumed]),
      equals([["cancel", "executed", true]]),
    );

    const cancelledAt = run.turns.findIndex((turn) => executionsIn(turn).some((output) => output.kind === "cancelled"));
    await t.require(cancelledAt >= 0, equals(true));
    t.check(
      run.turns.slice(0, cancelledAt).some((turn) => /\bCancelled\b/.test(turn.reply)),
      equals(false),
    ).label("no Cancelled before the status check");
  },
});
