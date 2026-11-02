import { defineEvalConfig } from "eve/evals";

// `pnpm eval` runs these offline: ERRAND_MODELS=main=scripted swaps the agent's model for the
// scripted mockModel, and the mock world needs no network.
export default defineEvalConfig({
  timeoutMs: 60_000,
});
