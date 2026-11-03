import { equals } from "eve/evals/expect";

import { bookingChanges, cardsIn, executionsIn } from "../../approval-checks";
import { ASK_FOR_PLUMBER, CHEAPEST_PLUMBER, executeTurn, FIRST_BOOKING_ID, HOLD_AND_PROPOSE_TURN, SEARCH_TURN } from "../../booking-conversation";
import { defineScenario } from "../../scenario";

// Choose on a provider card sends "I'll take <name>, <earliest slot>." as the person. The agent
// holds that slot and shows the fixed approval card; nothing is booked by the Choose. Only the
// tap on Approve on the card books, once.

export default defineScenario({
  id: "scenarios/generated-ui/choose-holds-and-shows-the-card",
  description: "Choose on a provider card holds its slot and shows the approval card; only Approve books.",
  world: { scenario: "happy_path", seed: 42 },
  user: [{ say: ASK_FOR_PLUMBER }, { choose: CHEAPEST_PLUMBER.providerId }, { card: "approve" }],
  model: {
    turns: [SEARCH_TURN, HOLD_AND_PROPOSE_TURN, executeTurn(`Booked: Shiva Sanitary Solutions, ₹399. Booking ID ${FIRST_BOOKING_ID}.`)],
  },
  expected:
    "Choose sends \"I'll take Shiva Sanitary Solutions, <its earliest slot>.\"; that turn holds the slot and shows the card with no execute; after Approve exactly one booking for the held slot",
  async expect(t, run) {
    t.succeeded();
    t.check(run.uiTaps.map((tap) => tap.sent), equals(["I'll take Shiva Sanitary Solutions, Thu, 5 Nov, 8:00 am IST."])).label(
      "Choose sends the card's name and earliest slot",
    );
    const chooseTurn = run.turns[1];
    t.check(cardsIn(chooseTurn).length, equals(1)).label("the Choose turn shows the approval card");
    t.check(executionsIn(chooseTurn).length, equals(0)).label("the Choose turn executes nothing");
    t.check(run.taps.map((tap) => `${tap.tap} ${tap.status}`), equals(["approve 200"]));

    const { made } = await bookingChanges(run);
    t.check(
      made.map((booking) => [booking.providerId, booking.slot.start, booking.priceInr]),
      equals([[CHEAPEST_PLUMBER.providerId, CHEAPEST_PLUMBER.slot.start, CHEAPEST_PLUMBER.priceInr]]),
    ).label("one booking, for the chosen card's slot, made after Approve");
    t.check(executionsIn(run.turns.at(-1)).map((output) => output.kind), equals(["booked"]));
  },
});
