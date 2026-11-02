import { defineAgent } from "eve";

import { container } from "../src/composition/container";

// The model is an AI SDK instance chosen by ERRAND_MODELS (see src/adapters/models), so MiniMax is
// called directly and the offline evals swap in the scripted model with the same agent.
export default defineAgent({
  model: container().modelFor("main"),
  modelContextWindowTokens: 1_000_000,
});
