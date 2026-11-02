// Sends one errand through the client package, the same way the web app does, and prints what
// the agent did. Run against a started backend: `pnpm dev` (or `pnpm dev:backend`), then
// `pnpm smoke:search`. Exits non-zero unless search_providers ran and its providers are the
// world's own.
import { ApiClient, ChatClient, DEFAULT_BACKEND_URL } from "@errand/client";
import { SearchProvidersOutputSchema } from "@errand/contracts";

const baseUrl = process.env.ERRAND_BACKEND_URL ?? DEFAULT_BACKEND_URL;
const message = process.argv.slice(2).join(" ") || "find a plumber in Koramangala this week";

const api = new ApiClient({ baseUrl });
const chat = new ChatClient({ baseUrl });

const world = await api.switchScenario({ scenario: "default", seed: Number(process.env.ERRAND_SEED ?? 42) });
console.log(`world: scenario=${world.scenario} seed=${world.seed}`);
console.log(`user: ${message}`);

const startedAt = Date.now();
const turn = await chat.sendFirstMessage(message, { signal: AbortSignal.timeout(180_000) });
console.log(`session: ${turn.sessionId} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);

const started = turn.events.find((event) => event.type === "model.started");
if (started !== undefined) console.log(`model: ${JSON.stringify(started.data)}`);

for (const call of turn.toolCalls) {
  console.log(`tool: ${call.name} [${call.state}] input=${JSON.stringify(call.input)}`);
}
const search = turn.toolCalls.find((call) => call.name === "search_providers" && call.state === "completed");
if (search === undefined) {
  console.error("FAIL: search_providers was not called to completion.");
  process.exit(1);
}

const output = SearchProvidersOutputSchema.parse(search.output);
if (output.kind !== "found") {
  console.error(`FAIL: search returned ${output.kind}.`);
  process.exit(1);
}
console.log(`search returned ${output.providers.length} providers:`);
for (const provider of output.providers) {
  console.log(`  ${provider.id}  ${provider.name}  ₹${provider.priceInr}  ★${provider.rating}  ${provider.freeSlots.length} slots`);
}

// The tool and the app API must read the same world instance.
const fromApi = await api.getProviders(output.providers.map((provider) => provider.id));
const mismatched = output.providers.filter(
  (provider) => fromApi.find((candidate) => candidate.id === provider.id)?.priceInr !== provider.priceInr,
);
if (mismatched.length > 0) {
  console.error(`FAIL: /api/v1/providers disagrees with the tool for ${mismatched.map((p) => p.id).join(", ")}.`);
  process.exit(1);
}
console.log("app API agrees with the tool on every provider.");
console.log(`\nassistant:\n${turn.reply}`);
