import { equals } from "eve/evals/expect";

import { errandAfter, questionsIn, searchesIn, THIS_WEEK, tracedTransitions, updatesIn } from "../../errand-checks";
import { defineScenario } from "../../scenario";

// SPEC "only missing details asked", the half with a gap: "a plumber this week" names the service
// and the time window, so the one thing to ask is the area. One question, about the area, with
// area quick replies, and no search until it is answered.

export default defineScenario({
  id: "scenarios/clarify/missing-area-asks-one-question",
  description: "A request missing only the area gets exactly one question, about the area, then a search once it is answered.",
  world: { scenario: "default", seed: 42 },
  user: [{ say: "I need a plumber this week" }, { say: "Koramangala" }],
  goal:
    "You need a plumber this week to fix a leaking kitchen tap. Your first message says only that you need " +
    "a plumber this week; don't mention where you live. When the assistant asks where, answer Koramangala. " +
    "Don't book anything; once you have seen some options you are done.",
  maxSimulatedMessages: 2,
  model: {
    turns: [
      {
        steps: [
          { toolCalls: [{ name: "update_errand", input: { service: "plumber", time_window: THIS_WEEK } }] },
          { text: "Which area of Bengaluru should the plumber come to?" },
        ],
      },
      {
        steps: [
          { toolCalls: [{ name: "update_errand", input: { area: "Koramangala" } }] },
          {
            toolCalls: [
              { name: "search_providers", input: { service: "plumber", area: "Koramangala", date_range: THIS_WEEK } },
            ],
          },
          { text: "Here are three plumbers in Koramangala this week: the best match, the cheapest and the earliest." },
        ],
      },
    ],
  },
  expected:
    "turn 1: the errand misses only the area, the reply asks exactly one question (about the area) with area quick replies, no search; " +
    "after the answer the errand is choosing with the area filled; every transition is in the trace",
  async expect(t, run) {
    t.succeeded();
    const [first, second] = run.turns;
    await t.require(first !== undefined, equals(true));

    // Turn 1: the errand knows service and week, misses only the area, and the agent asks one question.
    const asked = errandAfter(first);
    await t.require(asked !== undefined, equals(true));
    t.check(asked?.service, equals("plumber"));
    t.check(asked?.missing, equals(["area"])).label("only the area is missing");
    t.check(asked?.question?.fields, equals(["area"])).label("the question is about the area");
    t.check(asked?.question?.quickReplies.every((reply) => reply.field === "area"), equals(true)).label("area quick replies");
    t.check(searchesIn(first).length, equals(0)).label("no search before the area is known");
    t.check(questionsIn(first?.reply ?? ""), equals(1)).label("exactly one question in the reply");
    t.check(/area|where|neighbourhood|locality|location|part of/i.test(first?.reply ?? ""), equals(true)).label(
      "the question is about where",
    );
    // The first message must not be re-asked for what it already said.
    t.check(updatesIn(first).every((update) => update.kind === "updated"), equals(true));

    // After the answer: the area is filled, nothing else changed, and options are on screen.
    const final = await run.api.getErrand(run.sessionId);
    t.check(final?.area, equals("Koramangala"));
    t.check(final?.service, equals("plumber"));
    t.check(final?.missing, equals([]));
    t.check(final?.state, equals("choosing")).label("options are on screen");
    t.check(searchesIn(second).some((search) => search.kind === "found"), equals(true));

    const transitions = await tracedTransitions(run);
    t.check(transitions.inTrace, equals(transitions.inErrand)).label("every transition is in the trace");
    t.check(transitions.inErrand, equals(["start → gathering", "gathering → searching", "searching → choosing"]));
  },
});
