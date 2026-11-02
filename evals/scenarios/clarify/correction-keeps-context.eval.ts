import { equals } from "eve/evals/expect";

import { THIS_WEEK, tracedTransitions, updatesIn } from "../../errand-checks";
import { defineScenario } from "../../scenario";

// SPEC "correction keeps other fields": after options are shown, "actually Saturday" changes the
// date and nothing else. Service, area and budget are what they were.

const SATURDAY = { from: "2026-11-07", to: "2026-11-07" };

export default defineScenario({
  id: "scenarios/clarify/correction-keeps-context",
  description: "Changing the date after seeing options changes only the date; service, area and budget stay.",
  world: { scenario: "default", seed: 42 },
  user: [
    { say: "Find a plumber in Koramangala this week, under ₹1,500" },
    { say: "Actually, make it Saturday" },
  ],
  goal:
    "You need a plumber in Koramangala this week, under ₹1,500; say all of that in your first message. " +
    "Once you see options, change your mind about the day: say you'd rather have them come on Saturday. " +
    "Don't book anything; once you have seen Saturday options you are done.",
  maxSimulatedMessages: 2,
  model: {
    turns: [
      {
        steps: [
          {
            toolCalls: [
              {
                name: "update_errand",
                input: { service: "plumber", area: "Koramangala", time_window: THIS_WEEK, budget_inr: 1_500 },
              },
            ],
          },
          {
            toolCalls: [
              { name: "search_providers", input: { service: "plumber", area: "Koramangala", date_range: THIS_WEEK } },
            ],
          },
          { text: "Here are three plumbers in Koramangala this week under ₹1,500." },
        ],
      },
      {
        steps: [
          { toolCalls: [{ name: "update_errand", input: { time_window: SATURDAY } }] },
          {
            toolCalls: [
              { name: "search_providers", input: { service: "plumber", area: "Koramangala", date_range: SATURDAY } },
            ],
          },
          { text: "Here are the plumbers free on Saturday, still under ₹1,500." },
        ],
      },
    ],
  },
  expected:
    "after the date change the errand holds Saturday, and service, area and budget are unchanged; the errand went back to gathering and on to choosing, all traced",
  async expect(t, run) {
    t.succeeded();
    await t.require(run.turns.length >= 2, equals(true));
    const before = updatesIn(run.turns[0]).at(-1)?.errand;
    await t.require(before !== undefined, equals(true));

    const after = await run.api.getErrand(run.sessionId);
    t.check([after?.timeWindow?.from, after?.timeWindow?.to], equals([SATURDAY.from, SATURDAY.to])).label("the date changed");
    t.check(after?.service, equals(before?.service)).label("service unchanged");
    t.check(after?.area, equals(before?.area)).label("area unchanged");
    t.check(after?.budgetInr, equals(before?.budgetInr)).label("budget unchanged");
    t.check([after?.service, after?.area, after?.budgetInr], equals(["plumber", "Koramangala", 1_500]));
    t.check(after?.state, equals("choosing"));

    const transitions = await tracedTransitions(run);
    t.check(transitions.inTrace, equals(transitions.inErrand)).label("every transition is in the trace");
    t.check(transitions.inErrand.includes("choosing → gathering") || transitions.inErrand.includes("choosing → searching"), equals(true)).label(
      "the correction reopened the search",
    );
  },
});
