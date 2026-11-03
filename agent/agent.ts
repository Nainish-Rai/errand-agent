import { defineAgent } from "eve";
import { defineDynamic } from "eve/models";

import { container } from "../src/composition/container";
import { presentRunOutcome } from "./lib/run-outcome-presenter";
import { runKeyOf } from "./lib/run-key";

// The model is an AI SDK instance chosen by ERRAND_MODELS (see src/adapters/models), so MiniMax is
// called directly and the offline evals swap in the scripted model with the same agent.
//
// It is resolved per model call (defineDynamic) because each run gets the model wrapped in its own
// run budget: eve has no caps on model calls, tool calls or time per turn, so the budget lives in
// the one place every step passes through.
export default defineAgent({
  model: defineDynamic((ctx) => ({
    model: container().budgetedModelFor("main", runKeyOf(ctx), presentRunOutcome),
    modelContextWindowTokens: 1_000_000,
  })),
});
