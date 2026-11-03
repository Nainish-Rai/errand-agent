import { equals } from "eve/evals/expect";

import { ASK_FOR_PLUMBER, CHOOSE_CHEAPEST, executeTurn, HOLD_AND_PROPOSE_TURN, SEARCH_TURN } from "../../booking-conversation";
import { expectBookedOnlyAfterFreshApproval } from "../../invalidation-checks";
import { defineScenario } from "../../scenario";

// SPEC "hold expired": the person taps Approve, but `book` finds the hold already lapsed and
// returns hold_expired. Core holds the same slot again and proposes it again; nothing is booked
// until the person taps Approve on the fresh card. World hold_expired, seed 42: the first book
// call lapses its hold; the slot is free to hold again, and the next book succeeds.

export default defineScenario({
  id: "scenarios/approval/hold-expired",
  description: "book returning hold_expired re-holds the slot and shows a fresh card: nothing is booked until a tap on the fresh card, then exactly once.",
  world: { scenario: "hold_expired", seed: 42 },
  user: [{ say: ASK_FOR_PLUMBER }, { say: CHOOSE_CHEAPEST }, { card: "approve" }, { card: "approve" }],
  goal:
    "You want a plumber in Koramangala this week. When you see the options, ask for the cheapest one. " +
    "When the approval card appears, tap Approve on it. If the assistant says the hold ran out and shows a new card, " +
    "tap Approve on the new card. Once the assistant says it's booked and gives a booking ID, you are done.",
  maxSimulatedMessages: 5,
  model: {
    turns: [
      SEARCH_TURN,
      HOLD_AND_PROPOSE_TURN,
      executeTurn("The hold ran out before the booking went through, so nothing was booked. I've held the slot again: tap Approve ₹399 on the new card."),
      executeTurn("Booked: Shiva Sanitary Solutions, Thu 5 Nov at 8:00 am IST, ₹399. Booking ID bkg_0003."),
    ],
  },
  expected:
    "book returns hold_expired and nothing is booked; the slot is held again on a new hold and proposed on a fresh card; exactly one booking, made only by the second tap's grant",
  async expect(t, run) {
    const reapproved = await expectBookedOnlyAfterFreshApproval(t, run, "hold_reproposed");
    if (reapproved === undefined) return;
    const { refusal, first, fresh } = reapproved;

    t.check(first.status, equals("expired")).label("the first proposal expired");
    // The first grant reached `book`, which refused: used, but it made nothing.
    t.check(first.grant?.consumed, equals(true)).label("the first grant reached book");
    t.check(first.bookingId, equals(null)).label("the first proposal booked nothing");
    t.check(fresh.terms.holdId === first.terms.holdId, equals(false)).label("the slot was held again on a new hold");
    t.check([fresh.terms.providerId, fresh.terms.slot.start, fresh.terms.priceInr], equals([
      first.terms.providerId,
      first.terms.slot.start,
      first.terms.priceInr,
    ])).label("the same slot at the same price was proposed again");
    t.check(refusal.message.includes("ran out"), equals(true)).label("the message says the hold ran out");
    if (run.mode === "offline") t.check([first.terms.holdId, fresh.terms.holdId], equals(["hold_0001", "hold_0002"]));
  },
});
