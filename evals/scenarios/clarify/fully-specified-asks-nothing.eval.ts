import { equals } from "eve/evals/expect";

import { errandAfter, questionsIn, searchesIn, THIS_WEEK, tracedTransitions } from "../../errand-checks";
import { defineScenario } from "../../scenario";

// SPEC "only missing details asked", the half with nothing missing: the SPEC's one-sentence
// request goes straight to a search, with no clarifying question.

const ERRAND = "Find a plumber for my kitchen tap in Koramangala this week, mornings only, under ₹1,500";

export default defineScenario({
  id: "scenarios/clarify/fully-specified-asks-nothing",
  description: "A fully specified request is searched in the same turn, with no clarifying question.",
  world: { scenario: "default", seed: 42 },
  user: [{ say: ERRAND }],
  goal:
    "You need a plumber for your kitchen tap in Koramangala this week, mornings only, under ₹1,500. Say all " +
    "of that in your first message. Don't book anything; once you have seen the options you are done.",
  maxSimulatedMessages: 1,
  model: {
    turns: [
      {
        steps: [
          {
            toolCalls: [
              {
                name: "update_errand",
                input: {
                  service: "plumber",
                  area: "Koramangala",
                  time_window: { ...THIS_WEEK, earliest_hour: 8, latest_hour: 12 },
                  budget_inr: 1_500,
                },
              },
            ],
          },
          {
            toolCalls: [
              { name: "search_providers", input: { service: "plumber", area: "Koramangala", date_range: THIS_WEEK } },
            ],
          },
          { text: "Here are three plumbers who can come on a morning this week, all under ₹1,500." },
        ],
      },
    ],
  },
  expected: "one turn: the errand is complete with no question, search_providers runs in that turn, the errand ends choosing and the reply asks nothing",
  async expect(t, run) {
    t.succeeded();
    await t.require(run.turns.length, equals(1));
    const [turn] = run.turns;
    const errand = errandAfter(turn);
    t.check(errand?.missing, equals([])).label("nothing missing");
    t.check(errand?.question ?? null, equals(null)).label("no clarifying question");
    t.check(searchesIn(turn).some((search) => search.kind === "found"), equals(true)).label("searched in the first turn");
    t.check(questionsIn(turn?.reply ?? ""), equals(0)).label("the reply asks nothing");

    const final = await run.api.getErrand(run.sessionId);
    t.check(final?.state, equals("choosing"));
    t.check(final?.budgetInr, equals(1_500));
    t.check([final?.timeWindow?.earliestHour, final?.timeWindow?.latestHour], equals([8, 12]));

    const transitions = await tracedTransitions(run);
    t.check(transitions.inTrace, equals(transitions.inErrand)).label("every transition is in the trace");
  },
});
