import { equals } from "eve/evals/expect";

import { questionsIn, textBeforeSearch, THIS_WEEK, updatesIn } from "../../errand-checks";
import { factsFor, memoryCallsIn, memoryContextsOf, memoryPrefillsOf, rememberedIn, turnsOf } from "../../memory-checks";
import { defineScenario } from "../../scenario";

// SPEC story 35, "memory across sessions": the area the person asked the agent to remember in one
// chat is used in the next chat without asking, through a traced errand patch, and the agent says so.

export default defineScenario({
  id: "scenarios/memory/remembered-area-across-sessions",
  description: "An area saved in session 1 fills the errand in session 2, is never asked for, and is said aloud.",
  world: { scenario: "default", seed: 42 },
  user: [
    { say: "Find a plumber in Koramangala this week. Koramangala is my usual area, please remember it." },
    { newSession: true },
    { say: "I need a plumber this week" },
  ],
  goal:
    "You need a plumber in Koramangala this week. In your first message, also say that Koramangala is your usual " +
    "area and ask the assistant to remember it. Once you see options you are done; don't book anything.",
  laterGoals: [
    "You need a plumber this week. Don't mention any area. If the assistant asks where, answer Koramangala. " +
      "Once you see options you are done; don't book anything.",
  ],
  maxSimulatedMessages: 2,
  model: {
    turns: [
      {
        steps: [
          {
            toolCalls: [
              { name: "update_errand", input: { service: "plumber", area: "Koramangala", time_window: THIS_WEEK } },
              {
                name: "remember_fact",
                input: {
                  key: "area",
                  value: "Koramangala",
                  source: "explicit",
                  evidence_quote: "Koramangala is my usual area, please remember it",
                },
              },
            ],
          },
          { toolCalls: [{ name: "search_providers", input: { service: "plumber", area: "Koramangala", date_range: THIS_WEEK } }] },
          { text: "Here are three plumbers in Koramangala this week. I'll use Koramangala as your usual area next time." },
        ],
      },
      {
        steps: [
          { toolCalls: [{ name: "update_errand", input: { service: "plumber", time_window: THIS_WEEK } }] },
          { toolCalls: [{ name: "search_providers", input: { service: "plumber", area: "Koramangala", date_range: THIS_WEEK } }] },
          { text: "Using your usual area, Koramangala. Here are three plumbers free this week." },
        ],
      },
    ],
  },
  expected:
    "session 1 stores area=Koramangala as an explicit, active fact; session 2's errand gets that area from memory (a traced memory_used patch) with no area question, and the reply names Koramangala",
  async expect(t, run) {
    t.succeeded();
    await t.require(run.sessionIds.length, equals(2));
    const [first, second] = run.sessionIds;

    const written = memoryCallsIn(turnsOf(run, first)).filter((call) => call.name === "remember_fact");
    t.check(written.map((call) => call.output.kind), equals(["remembered"])).label("session 1 remembered the area");

    const memory = await run.api.listMemory();
    t.check(
      factsFor(memory, "area").map((fact) => [fact.value, fact.source, fact.status]),
      equals([["Koramangala", "explicit", "active"]]),
    ).label("memory holds one explicit, active area");

    const [comeback] = turnsOf(run, second);
    await t.require(comeback !== undefined, equals(true));
    t.check(rememberedIn(comeback).map((detail) => [detail.field, detail.value]), equals([["area", "Koramangala"]])).label(
      "memory filled in the area",
    );
    t.check(updatesIn(comeback).at(0)?.errand.question?.fields.includes("area") ?? false, equals(false)).label("the area was never asked for");
    t.check(questionsIn(textBeforeSearch(comeback)), equals(0)).label("no question before the search");
    t.check((await run.api.getErrand(second ?? ""))?.area, equals("Koramangala")).label("session 2's errand has the remembered area");
    t.check(comeback?.reply.includes("Koramangala") ?? false, equals(true)).label("the reply says which remembered area it used");
    t.check(await memoryPrefillsOf(run, second ?? ""), equals(["memory → errand: area"])).label("the prefill is traced");

    const contexts = await memoryContextsOf(run, second ?? "");
    t.check(contexts.at(0)?.included.map((entry) => entry.key), equals(["area"])).label("the area was in session 2's memory context");
  },
});
