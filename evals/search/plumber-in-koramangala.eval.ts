import { ApiClient, ChatClient } from "@errand/client";
import { SearchProvidersOutputSchema } from "@errand/contracts";
import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";

// The eval is a client like the web app: it seeds the world and chats through packages/client,
// then hands the session to eve's assertions. If this passes, any client that speaks the API works.
export default defineEval({
  description: "A plain errand searches the right service and area and returns the world's providers.",
  async test(t) {
    const api = new ApiClient({ baseUrl: t.target.url });
    const chat = new ChatClient({ baseUrl: t.target.url });

    await api.switchScenario({ scenario: "default", seed: 42 });
    const turn = await chat.sendFirstMessage("find a plumber in Koramangala this week", { signal: t.abortSignal });

    const session = t.target.attach(turn.sessionId, { startIndex: 0 });
    await session.nextTurn();
    t.succeeded();
    t.calledTool("search_providers", {
      input: { service: "plumber", area: "Koramangala" },
      count: 1,
    });

    const search = turn.toolCalls.find((call) => call.name === "search_providers");
    const output = SearchProvidersOutputSchema.parse(search?.output);
    await t.require(output.kind, equals("found"));
    if (output.kind !== "found") return;
    t.check(output.providers.length >= 3 && output.providers.length <= 8, equals(true));

    // Every provider the agent saw is the world's own, field for field.
    const fromWorld = await api.getProviders(output.providers.map((provider) => provider.id));
    t.check(
      output.providers.every((provider) => {
        const truth = fromWorld.find((candidate) => candidate.id === provider.id);
        return truth?.priceInr === provider.priceInr && truth.rating === provider.rating;
      }),
      equals(true),
    );
  },
});
