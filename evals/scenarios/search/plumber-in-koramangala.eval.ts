import { SearchProvidersOutputSchema } from "@errand/contracts";
import { equals } from "eve/evals/expect";

import { defineScenario } from "../../scenario";

// Ticket 01's tracer bullet as a scenario: a plain errand searches the right service and area and
// shows the world's own providers. The checks are the ticket 01 eval's, unchanged.

const ERRAND = "find a plumber in Koramangala this week";

export default defineScenario({
  id: "scenarios/search/plumber-in-koramangala",
  description: "A plain errand searches the right service and area and returns the world's providers.",
  world: { scenario: "default", seed: 42 },
  user: [{ say: ERRAND }],
  goal:
    "You need a plumber in Koramangala this week to fix a leaking kitchen tap. You want to see who is " +
    "available and what they charge. Don't book anything; once you have seen the options you are done.",
  maxSimulatedMessages: 2,
  model: {
    turns: [
      {
        steps: [
          {
            toolCalls: [
              {
                name: "search_providers",
                // The evals pin the clock to Wednesday 2026-11-04, so "this week" is fixed.
                input: { service: "plumber", area: "Koramangala", date_range: { from: "2026-11-04", to: "2026-11-10" } },
              },
            ],
          },
          { text: "Here are the plumbers in Koramangala with free slots this week." },
        ],
      },
    ],
  },
  expected: "search_providers runs once for plumber in Koramangala; 3 to 8 providers, each matching the world's price and rating",
  async expect(t, run) {
    t.succeeded();
    t.calledTool("search_providers", { input: { service: "plumber", area: "Koramangala" }, count: 1 });

    const search = run.toolCalls.find((call) => call.name === "search_providers");
    const output = SearchProvidersOutputSchema.parse(search?.output);
    await t.require(output.kind, equals("found"));
    if (output.kind !== "found") return;
    t.check(output.providers.length >= 3 && output.providers.length <= 8, equals(true));

    // Every provider the agent saw is the world's own, field for field.
    const fromWorld = await run.api.getProviders(output.providers.map((provider) => provider.id));
    t.check(
      output.providers.every((provider) => {
        const truth = fromWorld.find((candidate) => candidate.id === provider.id);
        return truth?.priceInr === provider.priceInr && truth.rating === provider.rating;
      }),
      equals(true),
    );
  },
});
