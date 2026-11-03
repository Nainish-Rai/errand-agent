import { ForgetFactInputSchema, MemoryToolOutputSchema } from "@errand/contracts";
import { defineTool } from "eve/tools";

import { container } from "../../src/composition/container";
import { forgetMemoryFact } from "../../src/core/use-cases/forget-memory-fact";
import { presentForgetOutcome } from "../lib/memory-presenter";
import { memoryToolCall, NO_PERSON } from "../lib/memory-tool-call";
import { withRunBudget } from "../lib/run-budget-tool";

export default withRunBudget(
  defineTool({
    description:
      "Forget a remembered preference when the person asks (\"forget my technician\"). It is never used or guessed " +
      "again unless they tell you again. Quote the words of their latest message.",
    label: { start: ({ key }) => `Forgetting your ${String(key).replace("_", " ")}` },
    inputSchema: ForgetFactInputSchema,
    outputSchema: MemoryToolOutputSchema,
    async execute(input, ctx) {
      const call = memoryToolCall(ctx);
      if (call === undefined) return NO_PERSON;
      const outcome = await forgetMemoryFact(container().memoryDependencies, {
        ownerId: call.ownerId,
        key: input.key,
        evidence: call.evidence(input.evidence_quote),
      });
      return presentForgetOutcome(outcome);
    },
  }),
);
