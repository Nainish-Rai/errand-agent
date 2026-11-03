import { equals } from "eve/evals/expect";

import { rupeeLabel } from "../../approval-checks";
import { ASK_FOR_PLUMBER, CHOOSE_CHEAPEST, executeTurn, holdAndProposeTurn, SEARCH_TURN } from "../../booking-conversation";
import { expectBookedOnlyAfterFreshApproval } from "../../invalidation-checks";
import { defineScenario } from "../../scenario";

// SPEC "price changed on hold": the person taps Approve, but the provider raised the held price
// before the booking. Core re-reads the live hold, voids the grant and books nothing; the agent
// says what the price went from and to, and shows a fresh card. Only a tap on that card books.
// World price_changed_on_hold, seed 42: the cheapest plumber's hold quotes ₹479 (search ₹399) and
// rises to ₹575 after the approval.

export default defineScenario({
  id: "scenarios/approval/price-changed-on-hold",
  description: "A price raised after the tap voids the approval: nothing is booked, the agent names the old and new price, and only a tap on the fresh card books, once.",
  world: { scenario: "price_changed_on_hold", seed: 42 },
  user: [{ say: ASK_FOR_PLUMBER }, { say: CHOOSE_CHEAPEST }, { card: "approve" }, { card: "approve" }],
  goal:
    "You want a plumber in Koramangala this week. When you see the options, ask for the cheapest one. " +
    "When the approval card appears, tap Approve on it. If the assistant says the price changed and shows a new card, " +
    "tap Approve on the new card. Once the assistant says it's booked and gives a booking ID, you are done.",
  maxSimulatedMessages: 5,
  model: {
    turns: [
      SEARCH_TURN,
      holdAndProposeTurn("I've held the slot. Check the card and tap Approve ₹479 if it's right."),
      executeTurn("The price went from ₹479 to ₹575 after you approved, so I booked nothing. A new card shows ₹575: tap Approve ₹575 if you still want it."),
      executeTurn("Booked: Shiva Sanitary Solutions, Thu 5 Nov at 8:00 am IST, ₹575. Booking ID bkg_0002."),
    ],
  },
  expected:
    "the first tap's grant is voided and books nothing; the reply names the old and new price; a fresh card shows the new price; exactly one booking, at the new price, made only by the second tap's grant",
  async expect(t, run) {
    const reapproved = await expectBookedOnlyAfterFreshApproval(t, run, "approval_invalidated");
    if (reapproved === undefined) return;
    const { refusal, refusalReply, first, fresh } = reapproved;

    t.check(first.status, equals("voided")).label("the first proposal is voided");
    t.check(first.grant?.voided, equals(true)).label("the first grant is voided");
    t.check(first.grant?.consumed, equals(false)).label("the first grant was never used");
    const change = { field: "price", from: first.terms.priceInr, to: fresh.terms.priceInr };
    t.check(refusal.changes, equals([change])).label("the outcome carries the old and new price");
    t.check(first.invalidation?.changes, equals([change])).label("the voided proposal keeps what changed");
    t.check(fresh.terms.priceInr > first.terms.priceInr, equals(true)).label("the fresh card shows the raised price");
    t.check([fresh.terms.providerId, fresh.terms.slot.start], equals([first.terms.providerId, first.terms.slot.start])).label("only the price changed");

    // The user-facing message names both values.
    const [oldPrice, newPrice] = [rupeeLabel(change.from), rupeeLabel(change.to)];
    t.check(refusal.message.includes(`went from ${oldPrice} to ${newPrice}`), equals(true)).label("the message names the old and new price");
    t.check(refusalReply.includes(oldPrice) && refusalReply.includes(newPrice), equals(true)).label("the reply names the old and new price");
    if (run.mode === "offline") t.check([change.from, change.to], equals([479, 575]));
  },
});
