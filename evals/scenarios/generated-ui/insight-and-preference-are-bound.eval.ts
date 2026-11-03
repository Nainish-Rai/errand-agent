import { equals } from "eve/evals/expect";

import { ASK_FOR_PLUMBER, CHEAPEST_PLUMBER } from "../../booking-conversation";
import { THIS_WEEK } from "../../errand-checks";
import { askUi, presentUi } from "../../generated-ui-conversation";
import { generatedUiCalls } from "../../generated-ui-checks";
import { defineScenario } from "../../scenario";

// The two components that bind to tickets 09 and 11: a ReviewInsight names a provider whose insight
// get_provider_insight returned, and is drawn; a PreferenceCard naming a fact id that is not one of
// the person's inferred facts waiting for confirmation is refused, so the model can't make up a
// "remembered" preference.

export default defineScenario({
  id: "scenarios/generated-ui/insight-and-preference-are-bound",
  description: "A review-insight card for a read provider is drawn; a preference card naming no inferred fact of the person's is refused.",
  world: { scenario: "happy_path", seed: 42 },
  user: [{ say: ASK_FOR_PLUMBER }, { say: "What do reviews say about the cheapest one?" }],
  model: {
    turns: [
      {
        steps: [
          { toolCalls: [{ name: "search_providers", input: { service: "plumber", area: "Koramangala", date_range: THIS_WEEK } }] },
          { toolCalls: [{ name: "get_provider_insight", input: { provider_ids: [CHEAPEST_PLUMBER.providerId] } }] },
          { text: "Here are the best match, the cheapest and the earliest plumber in Koramangala this week." },
        ],
      },
      {
        steps: [
          presentUi(["root = Stack([insight])", `insight = ReviewInsight("${CHEAPEST_PLUMBER.providerId}")`]),
          askUi(["root = Stack([prefs])", 'prefs = PreferenceCard(["fact_made_up"])']),
          { text: "Here is what reviews say about Shiva Sanitary Solutions." },
        ],
      },
    ],
  },
  expected: "the ReviewInsight is shown; the PreferenceCard is refused because fact_made_up is not an inferred fact waiting for confirmation",
  async expect(t, run) {
    t.succeeded();
    const calls = generatedUiCalls(run.turns);
    await t.require(calls.map((call) => `${call.tool} ${call.verdict.kind}`), equals(["present_ui shown", "ask_ui refused"]));
    const refused = calls[1]?.verdict;
    t.check(refused?.kind === "refused" && refused.problems.some((problem) => problem.includes("fact_made_up is not an inferred fact")), equals(true)).label(
      "refused for naming no inferred fact",
    );
  },
});
