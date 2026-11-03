import { equals } from "eve/evals/expect";

import { istLabel } from "../../approval-checks";
import { ASK_FOR_PLUMBER, CHOOSE_CHEAPEST, executeTurn, HOLD_AND_PROPOSE_TURN, SEARCH_TURN } from "../../booking-conversation";
import { expectBookedOnlyAfterFreshApproval } from "../../invalidation-checks";
import { defineScenario } from "../../scenario";

// SPEC "slot changed after approval": the person taps Approve, but the provider moved the held
// visit before the booking. Core re-reads the live hold, voids the grant and books nothing; the
// agent says what the time went from and to, and shows a fresh card. Only a tap on it books.
// World slot_changed_after_approval, seed 42: the cheapest plumber's Thursday 08:00 hold moves to 12:00.

export default defineScenario({
  id: "scenarios/approval/slot-changed-after-approval",
  description: "A visit moved after the tap voids the approval: nothing is booked, the agent names the old and new time, and only a tap on the fresh card books, once.",
  world: { scenario: "slot_changed_after_approval", seed: 42 },
  user: [{ say: ASK_FOR_PLUMBER }, { say: CHOOSE_CHEAPEST }, { card: "approve" }, { card: "approve" }],
  goal:
    "You want a plumber in Koramangala this week. When you see the options, ask for the cheapest one. " +
    "When the approval card appears, tap Approve on it. If the assistant says the time changed and shows a new card, " +
    "tap Approve on the new card. Once the assistant says it's booked and gives a booking ID, you are done.",
  maxSimulatedMessages: 5,
  model: {
    turns: [
      SEARCH_TURN,
      HOLD_AND_PROPOSE_TURN,
      executeTurn(
        "The time went from Thu, 5 Nov, 8:00 am IST to Thu, 5 Nov, 12:00 pm IST after you approved, so I booked nothing. " +
          "A new card shows the new time: tap Approve ₹399 if it still works for you.",
      ),
      executeTurn("Booked: Shiva Sanitary Solutions, Thu 5 Nov at 12:00 pm IST, ₹399. Booking ID bkg_0002."),
    ],
  },
  expected:
    "the first tap's grant is voided and books nothing; the reply names the old and new time; a fresh card shows the new slot; exactly one booking, at the new slot, made only by the second tap's grant",
  async expect(t, run) {
    const reapproved = await expectBookedOnlyAfterFreshApproval(t, run, "approval_invalidated");
    if (reapproved === undefined) return;
    const { refusal, first, fresh } = reapproved;

    t.check(first.status, equals("voided")).label("the first proposal is voided");
    t.check(first.grant?.voided, equals(true)).label("the first grant is voided");
    t.check(first.grant?.consumed, equals(false)).label("the first grant was never used");
    const change = { field: "slot", from: first.terms.slot, to: fresh.terms.slot };
    t.check(refusal.changes, equals([change])).label("the outcome carries the old and new slot");
    t.check(first.invalidation?.changes, equals([change])).label("the voided proposal keeps what changed");
    t.check(Date.parse(fresh.terms.slot.start) > Date.parse(first.terms.slot.start), equals(true)).label("the fresh card shows the later slot");
    t.check([fresh.terms.providerId, fresh.terms.priceInr], equals([first.terms.providerId, first.terms.priceInr])).label("only the slot changed");

    const [oldTime, newTime] = [istLabel(change.from.start), istLabel(change.to.start)];
    t.check(refusal.message.includes(`went from ${oldTime} to ${newTime}`), equals(true)).label("the message names the old and new time");
    if (run.mode === "offline") {
      t.check([change.from.start, change.to.start], equals(["2026-11-05T08:00:00+05:30", "2026-11-05T12:00:00+05:30"]));
    }
  },
});
