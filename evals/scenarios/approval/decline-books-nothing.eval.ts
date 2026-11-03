import { equals } from "eve/evals/expect";

import { bookingChanges } from "../../approval-checks";
import { ASK_FOR_PLUMBER, CHOOSE_CHEAPEST, HOLD_AND_PROPOSE_TURN, SEARCH_TURN } from "../../booking-conversation";
import { defineScenario } from "../../scenario";

// Decline on the card: nothing is booked, no grant exists, the held slot is free again in the
// world, and the errand is back to its options.

export default defineScenario({
  id: "scenarios/approval/decline-books-nothing",
  description: "Declining the approval card books nothing, mints no grant and gives the held slot back.",
  world: { scenario: "happy_path", seed: 42 },
  user: [{ say: ASK_FOR_PLUMBER }, { say: CHOOSE_CHEAPEST }, { card: "decline" }],
  goal:
    "You want a plumber in Koramangala this week. When you see the options, ask for the cheapest one. " +
    "When the approval card appears, tap Decline on it. Once the assistant has replied to that, you are done.",
  maxSimulatedMessages: 3,
  model: {
    turns: [
      SEARCH_TURN,
      HOLD_AND_PROPOSE_TURN,
      { steps: [{ text: "Okay, I've let the slot go and nothing was booked. Want to pick another option?" }] },
    ],
  },
  expected: "after Decline no booking exists and no grant was minted; the proposal is declined, the held slot is free again and the errand is back to choosing",
  async expect(t, run) {
    t.succeeded();
    await t.require(run.taps.map((tap) => `${tap.tap} ${tap.status}`), equals(["decline 200"]));
    t.check((await bookingChanges(run)).made.length, equals(0)).label("no booking");

    const [proposal] = await run.api.listSessionProposals(run.sessionId);
    await t.require(proposal !== undefined, equals(true));
    if (proposal === undefined) return;
    t.check(proposal.status, equals("declined"));
    t.check(proposal.grant, equals(null)).label("no grant");
    t.check((await run.api.getErrand(run.sessionId))?.state, equals("choosing"));

    // The hold is released: the provider offers the held slot again.
    const provider = await run.api.getProvider(proposal.terms.providerId);
    t.check(provider.freeSlots.some((slot) => slot.start === proposal.terms.slot.start), equals(true)).label(
      "the held slot is free again",
    );

    // A late Approve on the declined card mints nothing.
    const late = await t.target.fetch(`/api/v1/proposals/${proposal.proposalId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fingerprint: proposal.fingerprint }),
    });
    t.check(late.status, equals(409)).label("approving a declined card is refused");
  },
});
