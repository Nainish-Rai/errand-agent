import { equals } from "eve/evals/expect";

import { THIS_WEEK, updatesIn } from "../../errand-checks";
import { factsFor, memoryCallsIn, memoryContextsOf, rememberedIn, turnsOf } from "../../memory-checks";
import { defineScenario } from "../../scenario";

// SPEC stories 39 and 40, "inferred fact unconfirmed vs confirmed": a preference the agent only
// noticed is saved as a guess and asked about. Until the person says yes it is never used; after
// they do, it is.

export default defineScenario({
  id: "scenarios/memory/inferred-unconfirmed-vs-confirmed",
  description: "An inferred area isn't used while unconfirmed (the area is asked for); once confirmed, the next session uses it.",
  world: { scenario: "default", seed: 42 },
  user: [
    { say: "Find a plumber in HSR Layout this week" },
    { newSession: true },
    { say: "I need a plumber this week" },
    { say: "HSR Layout. And yes, please remember HSR Layout as my usual area." },
    { newSession: true },
    { say: "I need a plumber this week" },
  ],
  goal:
    "You need a plumber in HSR Layout this week. Don't say whether it is your usual area. If the assistant asks " +
    "whether to remember it, don't answer that question. Once you see options you are done.",
  laterGoals: [
    "You need a plumber this week. Don't mention an area in your first message. When asked where, say HSR Layout " +
      "and, in the same message, tell it to remember HSR Layout as your usual area. Once you see options you are done.",
    "You need a plumber this week. Don't mention any area. If asked where, say HSR Layout. Once you see options you are done.",
  ],
  maxSimulatedMessages: 2,
  model: {
    turns: [
      {
        steps: [
          {
            toolCalls: [
              { name: "update_errand", input: { service: "plumber", area: "HSR Layout", time_window: THIS_WEEK } },
              {
                name: "remember_fact",
                input: { key: "area", value: "HSR Layout", source: "inferred", evidence_quote: "a plumber in HSR Layout" },
              },
            ],
          },
          { toolCalls: [{ name: "search_providers", input: { service: "plumber", area: "HSR Layout", date_range: THIS_WEEK } }] },
          { text: "Here are three plumbers in HSR Layout this week. Should I remember HSR Layout as your usual area?" },
        ],
      },
      {
        steps: [
          { toolCalls: [{ name: "update_errand", input: { service: "plumber", time_window: THIS_WEEK } }] },
          { text: "Which area should the plumber come to?" },
        ],
      },
      {
        steps: [
          {
            toolCalls: [
              { name: "update_errand", input: { area: "HSR Layout" } },
              { name: "confirm_fact", input: { key: "area", evidence_quote: "yes, please remember HSR Layout as my usual area" } },
            ],
          },
          { toolCalls: [{ name: "search_providers", input: { service: "plumber", area: "HSR Layout", date_range: THIS_WEEK } }] },
          { text: "Done, HSR Layout is your usual area now. Here are three plumbers there this week." },
        ],
      },
      {
        steps: [
          { toolCalls: [{ name: "update_errand", input: { service: "plumber", time_window: THIS_WEEK } }] },
          { toolCalls: [{ name: "search_providers", input: { service: "plumber", area: "HSR Layout", date_range: THIS_WEEK } }] },
          { text: "Using your usual area, HSR Layout. Here are three plumbers free this week." },
        ],
      },
    ],
  },
  expected:
    "the inferred area waits for confirmation and isn't used (session 2 asks for the area); after the person confirms it, session 3 fills the area from memory",
  async expect(t, run) {
    t.succeeded();
    await t.require(run.sessionIds.length, equals(3));
    const [first, second, third] = run.sessionIds;

    const noticed = memoryCallsIn(turnsOf(run, first)).find((call) => call.name === "remember_fact");
    t.check([noticed?.output.kind, noticed?.output.fact?.status], equals(["remembered", "pending_confirmation"])).label(
      "the noticed area was saved as a guess",
    );

    const [asked, answered] = turnsOf(run, second);
    t.check(rememberedIn(asked), equals([])).label("an unconfirmed guess is not used");
    t.check(updatesIn(asked).at(-1)?.errand.question?.fields.includes("area") ?? false, equals(true)).label("the area is asked for");
    const [unconfirmedContext] = await memoryContextsOf(run, second ?? "");
    t.check(unconfirmedContext?.included, equals([])).label("the guess never reached the model");
    t.check(unconfirmedContext?.excluded.map((entry) => entry.reason), equals(["unconfirmed"])).label("excluded as unconfirmed");

    t.check(memoryCallsIn(answered === undefined ? [] : [answered]).map((call) => call.output.kind), equals(["confirmed"])).label(
      "the person's yes confirmed it",
    );
    const [area] = factsFor(await run.api.listMemory(), "area");
    t.check([area?.value, area?.source, area?.status, area?.confirmedAt !== null], equals(["HSR Layout", "inferred", "active", true])).label(
      "confirmed: still inferred, now active",
    );

    const [later] = turnsOf(run, third);
    t.check(rememberedIn(later).map((detail) => [detail.field, detail.value]), equals([["area", "HSR Layout"]])).label(
      "after confirming, it is used",
    );
    t.check((await run.api.getErrand(third ?? ""))?.area, equals("HSR Layout"));
  },
});
