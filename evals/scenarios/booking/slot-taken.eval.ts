import type { ExecuteProposalOutput } from "@errand/contracts";
import { equals } from "eve/evals/expect";

import { bookingChanges, executionsIn } from "../../approval-checks";
import { ASK_FOR_PLUMBER, CHEAPEST_PLUMBER, CHOOSE_CHEAPEST, executeTurn, HOLD_AND_PROPOSE_TURN, SEARCH_TURN } from "../../booking-conversation";
import { sessionIntents } from "../../ledger-checks";
import { defineScenario } from "../../scenario";

// Ticket 07, "slot taken". Someone else books the approved slot first. Nothing is booked, the
// person hears it plainly with the next options, and the alternative they pick is a new proposal
// that needs its own tap on Approve: a typed "yes" books nothing.

/** The same plumber, later the same day: free in the world after 08:00 was taken. */
const LATER_SLOT = { start: "2026-11-05T12:00:00+05:30", end: "2026-11-05T13:00:00+05:30" } as const;

export default defineScenario({
  id: "scenarios/booking/slot-taken",
  description: "The approved slot is taken: nothing is booked, the next options are offered, and the alternative needs a new approval.",
  world: { scenario: "slot_taken", seed: 42 },
  user: [
    { say: ASK_FOR_PLUMBER },
    { say: CHOOSE_CHEAPEST },
    { card: "approve" },
    { say: "Then the same plumber at 12 the same day." },
    { say: "Yes, book it." },
  ],
  goal:
    "You want a plumber in Koramangala this week. When you see the options, ask for the cheapest one. " +
    "When the approval card appears, tap Approve on it. If the slot is gone, ask for the same plumber later that day, " +
    "and when a new card appears, say yes in the chat (don't tap it). Once the assistant has answered that, you are done.",
  maxSimulatedMessages: 5,
  model: {
    turns: [
      SEARCH_TURN,
      HOLD_AND_PROPOSE_TURN,
      executeTurn("Someone else booked that slot just before us, so nothing was booked. Here are the next options."),
      {
        steps: [
          { toolCalls: [{ name: "hold_slot", input: { provider_id: CHEAPEST_PLUMBER.providerId, slot: LATER_SLOT } }] },
          { toolCalls: [{ name: "propose_action", input: { action: "book" } }] },
          { text: "I've held 12:00. Check the new card and tap Approve ₹399 if it's right." },
        ],
      },
      executeTurn("Nothing is booked yet: only a tap on Approve on the card can book it."),
    ],
  },
  expected:
    "execute_proposal → slot_taken with the next options (the taken 08:00 slot not among them); no booking; the alternative is a new pending proposal with no grant; a typed yes → not_approved",
  actual(run) {
    const outputs = run.toolCalls.filter((call) => call.name === "execute_proposal").map((call) => (call.output as { kind?: string } | undefined)?.kind);
    return `execute_proposal → ${outputs.join(", ") || "none"}`;
  },
  async expect(t, run) {
    t.succeeded();
    const { made } = await bookingChanges(run);
    t.check(made.length, equals(0)).label("nothing is booked");

    const executions: ExecuteProposalOutput[] = run.turns.flatMap((turn) => executionsIn(turn));
    await t.require(executions[0]?.kind, equals("slot_taken"));
    const options = executions[0]?.options ?? [];
    t.check(options.length > 0, equals(true)).label("the next options are offered");
    // The plumber is still offered, but from the next free slot on: the taken one is gone.
    const plumber = options.find((option) => option.providerId === CHEAPEST_PLUMBER.providerId);
    t.check(plumber?.earliestSlot.start, equals(LATER_SLOT.start)).label("the taken slot is not offered again");
    t.check(/nothing was booked/i.test(executions[0]?.message ?? ""), equals(true)).label("the person hears that nothing was booked");

    const [first] = await sessionIntents(run.api, run.sessionId);
    t.check([first?.state, first?.failureReason], equals(["failed", "slot_taken"]));

    // The alternative is its own proposal, pending, with no grant: the typed yes didn't approve it.
    const proposals = await run.api.listSessionProposals(run.sessionId);
    const taken = proposals.find((proposal) => proposal.terms.slot.start === CHEAPEST_PLUMBER.slot.start);
    const latest = proposals.find((proposal) => proposal !== taken);
    t.check(proposals.length, equals(2)).label("the alternative is a new proposal");
    t.check(taken?.status, equals("failed")).label("the taken slot's proposal failed");
    t.check([latest?.status, latest?.grant], equals(["pending", null])).label("the alternative waits for its own approval");
    t.check(latest?.terms.slot.start, equals(LATER_SLOT.start));
    t.check(executions.at(-1)?.kind, equals("not_approved")).label("a typed yes books nothing");
  },
});
