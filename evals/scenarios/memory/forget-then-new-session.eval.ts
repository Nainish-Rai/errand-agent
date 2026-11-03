import { equals } from "eve/evals/expect";

import { THIS_WEEK, updatesIn } from "../../errand-checks";
import { factsFor, memoryCallsIn, memoryContextsOf, rememberedIn, turnsOf } from "../../memory-checks";
import { defineScenario } from "../../scenario";

// SPEC story 38, "memory forget, then a new session": forgetting writes a tombstone. The agent can't
// re-infer the area from the earlier message in the same chat, and a new chat neither uses nor
// knows it: the area is asked for again.

export default defineScenario({
  id: "scenarios/memory/forget-then-new-session",
  description: "A forgotten area is never used again: re-inferring it from old history is refused, and a new session asks for it.",
  world: { scenario: "default", seed: 42 },
  memory: [{ key: "area", value: "Koramangala", source: "explicit", status: "active", ageDays: 7 }],
  user: [
    { say: "Find a plumber in Koramangala this week" },
    { say: "Please forget my usual area." },
    { newSession: true },
    { say: "I need a plumber this week" },
  ],
  goal:
    "You need a plumber in Koramangala this week. Once you see options, ask the assistant to forget your usual area. " +
    "Once it says it has forgotten it you are done; don't book anything.",
  laterGoals: [
    "You need a plumber this week. Don't mention any area. If the assistant asks where, say you will decide later. " +
      "Then you are done.",
  ],
  maxSimulatedMessages: 2,
  model: {
    turns: [
      {
        steps: [
          { toolCalls: [{ name: "update_errand", input: { service: "plumber", area: "Koramangala", time_window: THIS_WEEK } }] },
          { toolCalls: [{ name: "search_providers", input: { service: "plumber", area: "Koramangala", date_range: THIS_WEEK } }] },
          { text: "Here are three plumbers in Koramangala this week." },
        ],
      },
      {
        steps: [
          { toolCalls: [{ name: "forget_fact", input: { key: "area", evidence_quote: "Please forget my usual area" } }] },
          // The old message is still in this chat's history. Guessing the area from it again is
          // what the tombstone must stop.
          {
            toolCalls: [
              {
                name: "remember_fact",
                input: { key: "area", value: "Koramangala", source: "inferred", evidence_quote: "a plumber in Koramangala" },
              },
            ],
          },
          { text: "Done, I've forgotten your usual area and won't use it again." },
        ],
      },
      {
        steps: [
          { toolCalls: [{ name: "update_errand", input: { service: "plumber", time_window: THIS_WEEK } }] },
          { text: "Which area should the plumber come to?" },
        ],
      },
    ],
  },
  expected:
    "the area is forgotten with a tombstone, re-inferring it from the earlier message is refused, and the new session's errand has no area and asks for it",
  async expect(t, run) {
    t.succeeded();
    await t.require(run.sessionIds.length, equals(2));
    const [first, second] = run.sessionIds;

    const calls = memoryCallsIn(turnsOf(run, first));
    t.check(calls.find((call) => call.name === "forget_fact")?.output.kind, equals("forgotten")).label("the area was forgotten");
    t.check(
      calls.filter((call) => call.name === "remember_fact").map((call) => call.output.kind),
      equals(calls.some((call) => call.name === "remember_fact") ? ["forgotten_key"] : []),
    ).label("any attempt to re-infer the area was refused");

    const memory = await run.api.listMemory();
    t.check(factsFor(memory, "area").every((fact) => fact.status === "forgotten"), equals(true)).label("every area fact is forgotten");
    t.check(memory.tombstones.map((tombstone) => tombstone.key), equals(["area"])).label("a tombstone was written");

    const [comeback] = turnsOf(run, second);
    t.check(rememberedIn(comeback), equals([])).label("the new session used nothing from memory");
    t.check((await run.api.getErrand(second ?? ""))?.area ?? null, equals(null)).label("the new session's errand has no area");
    t.check(updatesIn(comeback).at(-1)?.errand.question?.fields.includes("area") ?? false, equals(true)).label("the area is asked for again");

    const contexts = await memoryContextsOf(run, second ?? "");
    t.check(contexts.flatMap((context) => context.included), equals([])).label("nothing forgotten reached the model");
    t.check(contexts.at(0)?.excluded.map((entry) => entry.reason), equals(["forgotten"])).label("the area was excluded as forgotten");
  },
});
