import { equals } from "eve/evals/expect";

import { bookingChanges, cardsIn, executionsIn } from "../../approval-checks";
import { ASK_FOR_PLUMBER, CHOOSE_CHEAPEST, executeTurn, HOLD_AND_PROPOSE_TURN, SEARCH_TURN } from "../../booking-conversation";
import { defineScenario } from "../../scenario";

// A typed "yes" is not a tap on Approve. The agent may try to book (it calls execute_proposal),
// but core finds no grant: nothing is booked, no grant exists, and the same card is shown again.

export default defineScenario({
  id: "scenarios/approval/typed-yes-shows-the-card-again",
  description: 'Typing "yes" instead of tapping Approve books nothing and shows the same approval card again.',
  world: { scenario: "happy_path", seed: 42 },
  user: [{ say: ASK_FOR_PLUMBER }, { say: CHOOSE_CHEAPEST }, { say: "yes" }],
  goal:
    "You want a plumber in Koramangala this week. When you see the options, ask for the cheapest one. " +
    'When the approval card appears, do not tap any of its buttons: type "yes" in the chat instead. ' +
    "Once the assistant has answered that, you are done.",
  maxSimulatedMessages: 3,
  model: {
    turns: [
      SEARCH_TURN,
      HOLD_AND_PROPOSE_TURN,
      executeTurn("Nothing is booked yet: only a tap on Approve ₹399 on the card can book it. Here's the card again."),
    ],
  },
  expected: 'after a typed "yes" no booking exists and no grant was minted; the proposal is still pending and the same card is shown again',
  async expect(t, run) {
    t.succeeded();
    t.check(run.taps.length, equals(0)).label("nothing was tapped");
    const { made } = await bookingChanges(run);
    t.check(made.length, equals(0)).label("no booking");

    const proposals = await run.api.listSessionProposals(run.sessionId);
    await t.require(proposals.length, equals(1));
    const [proposal] = proposals;
    t.check(proposal?.grant, equals(null)).label("no grant");
    t.check(proposal?.status, equals("pending"));
    t.check((await run.api.getErrand(run.sessionId))?.state, equals("awaiting_approval"));

    // The card is on screen again after the "yes": the same proposal, from execute_proposal's refusal.
    const yesTurn = run.turns.at(-1);
    const executions = executionsIn(yesTurn);
    t.check(executions.every((output) => output.kind === "not_approved"), equals(true)).label("execute refused without a grant");
    t.check(cardsIn(yesTurn).at(-1)?.proposalId, equals(proposal?.proposalId)).label("the card is shown again");
  },
});
