import { ProposeActionOutputSchema } from "@errand/contracts";
import { equals } from "eve/evals/expect";

import { AC_BOOKING, acBookingNow } from "../../booking-change-conversation";
import { bookingTrace } from "../../ledger-checks";
import { defineScenario } from "../../scenario";

// Tickets 10 and 14 meet here. Ravi Aircon Experts cancels the person's AC service; the person, who
// hears about it in a new chat, then asks to cancel it. No card is shown, no cancel is sent, and the
// agent says it was already cancelled by the provider: never "Cancelled", which would claim the
// person's own cancellation.

export default defineScenario({
  id: "scenarios/booking-changes/cancel-after-provider-cancelled",
  description: "Cancelling a booking the provider already cancelled shows no card, sends nothing and says it was cancelled by the provider.",
  world: { scenario: "happy_path", seed: 42 },
  user: [{ providerCancelled: { bookingId: AC_BOOKING.bookingId, eventId: "evt_ravi_cancels" } }, { say: "Cancel my AC servicing booking" }],
  goal:
    "Your AC servicing provider has just cancelled your visit, but you want to make sure it's cancelled: ask the assistant to " +
    "cancel your AC servicing booking. Don't ask for a replacement. Once the assistant has answered, you are done.",
  maxSimulatedMessages: 1,
  model: {
    turns: [
      { steps: [{ text: "Ravi Aircon Experts cancelled your AC servicing visit on Mon 9 Nov at 11:00 am. Want me to find another provider?" }] },
      {
        steps: [
          { toolCalls: [{ name: "list_bookings", input: {} }] },
          { toolCalls: [{ name: "propose_action", input: { action: "cancel", booking_id: AC_BOOKING.bookingId } }] },
          { text: "That booking was already cancelled by the provider, so there's nothing to cancel. Want me to find another AC service?" },
        ],
      },
    ],
  },
  expected:
    "the provider's event notifies a new chat; asked to cancel, no cancellation card is shown and no cancel is sent; the reply says the booking was already cancelled by the provider and never says Cancelled; the booking stays cancelled by the provider",
  actual(run) {
    const outputs = run.toolCalls.filter((call) => call.name === "propose_action").map((call) => (call.output as { kind?: string } | undefined)?.kind);
    return `propose_action → ${outputs.join(", ") || "none"}`;
  },
  async expect(t, run) {
    t.succeeded();
    await t.require(run.worldEvents.map((event) => event.outcome.kind), equals(["notified"]));

    const proposals = run.toolCalls.filter((call) => call.name === "propose_action" && call.output !== undefined).map((call) => ProposeActionOutputSchema.parse(call.output));
    t.check(proposals.some((output) => output.kind === "proposed"), equals(false)).label("no cancellation card is shown");
    const refused = proposals.find((output) => output.kind === "not_changeable");
    if (refused !== undefined) t.check(/already cancelled by the provider/.test(refused.message), equals(true)).label("core says who cancelled it");

    const last = run.turns.at(-1);
    t.check(/already cancelled by the provider|provider (already )?cancelled|cancelled by (the provider|Ravi)/i.test(last?.reply ?? ""), equals(true)).label(
      "the reply says the provider cancelled it",
    );
    t.check(run.turns.some((turn) => /\bCancelled\b/.test(turn.reply)), equals(false)).label("no reply claims the person's own cancellation");

    const booking = await acBookingNow(run.api);
    t.check([booking?.status, booking?.cancelledBy], equals(["cancelled", "provider"])).label("the booking stays the provider's cancellation");
    t.check(booking?.changes.length, equals(0)).label("no cancellation was approved");
    for (const sessionId of run.sessionIds) {
      const trace = await bookingTrace(run.api, sessionId);
      t.check(trace.worldCalls.filter((call) => call.startsWith("cancel")), equals([])).label("no cancel is sent");
    }
  },
});
