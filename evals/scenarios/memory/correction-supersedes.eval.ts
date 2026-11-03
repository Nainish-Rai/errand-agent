import { equals } from "eve/evals/expect";

import { THIS_WEEK } from "../../errand-checks";
import { factsFor, memoryCallsIn, memoryContextsOf, rememberedIn, turnsOf } from "../../memory-checks";
import { defineScenario } from "../../scenario";

// SPEC story 37, "memory correction": "actually my area is HSR" supersedes the remembered area. The
// old fact keeps its value and its validity window closes; only the new one is used afterwards.

export default defineScenario({
  id: "scenarios/memory/correction-supersedes",
  description: "Correcting the remembered area supersedes the old fact (never edits it), and only the new area is used next session.",
  world: { scenario: "default", seed: 42 },
  memory: [{ key: "area", value: "Koramangala", source: "explicit", status: "active", ageDays: 7 }],
  user: [
    { say: "Actually my usual area is HSR Layout now, not Koramangala. Please update that." },
    { newSession: true },
    { say: "I need a plumber this week" },
  ],
  goal:
    "Tell the assistant your usual area is HSR Layout now, not Koramangala, and ask it to update what it remembers. " +
    "Once it confirms the change you are done.",
  laterGoals: [
    "You need a plumber this week. Don't mention any area. If the assistant asks where, answer HSR Layout. " +
      "Once you see options you are done; don't book anything.",
  ],
  maxSimulatedMessages: 2,
  model: {
    turns: [
      {
        steps: [
          {
            toolCalls: [
              { name: "correct_fact", input: { key: "area", value: "HSR Layout", evidence_quote: "my usual area is HSR Layout now" } },
            ],
          },
          { text: "Updated: your usual area is HSR Layout now." },
        ],
      },
      {
        steps: [
          { toolCalls: [{ name: "update_errand", input: { service: "plumber", time_window: THIS_WEEK } }] },
          { toolCalls: [{ name: "search_providers", input: { service: "plumber", area: "HSR Layout", date_range: THIS_WEEK } }] },
          { text: "Using your usual area, HSR Layout. Here are the plumbers free this week." },
        ],
      },
    ],
  },
  expected:
    "the old area fact is superseded with its value and a closed window, a new explicit fact supersedes it, and session 2 uses only HSR Layout",
  async expect(t, run) {
    t.succeeded();
    await t.require(run.sessionIds.length, equals(2));
    const [first, second] = run.sessionIds;

    t.check(memoryCallsIn(turnsOf(run, first)).map((call) => call.output.kind), equals(["corrected"])).label("the correction was applied");

    const areas = factsFor(await run.api.listMemory(), "area");
    t.check(areas.map((fact) => [fact.value, fact.status]), equals([
      ["Koramangala", "superseded"],
      ["HSR Layout", "active"],
    ])).label("old superseded, new active");
    const [old, current] = areas;
    t.check(old?.validTo !== null && old?.validTo === current?.validFrom, equals(true)).label("the old window closed when the new one opened");
    t.check([old?.supersededBy, current?.supersedes], equals([current?.id, old?.id])).label("each fact names the other");

    const [comeback] = turnsOf(run, second);
    t.check(rememberedIn(comeback).map((detail) => detail.value), equals(["HSR Layout"])).label("only the new area was used");
    t.check((await run.api.getErrand(second ?? ""))?.area, equals("HSR Layout"));

    const [context] = await memoryContextsOf(run, second ?? "");
    t.check(context?.included.map((entry) => entry.id), equals([current?.id])).label("only the new fact reached the model");
    t.check(context?.excluded.map((entry) => [entry.id, entry.reason]), equals([[old?.id, "superseded"]])).label("the old one was excluded as superseded");
  },
});
