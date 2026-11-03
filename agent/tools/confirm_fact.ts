import { ConfirmFactInputSchema, MemoryToolOutputSchema } from "@errand/contracts";
import { defineTool } from "eve/tools";

import { container } from "../../src/composition/container";
import { confirmInferredFact } from "../../src/core/use-cases/confirm-inferred-fact";
import { presentConfirmOutcome } from "../lib/memory-presenter";
import { memoryToolCall, NO_PERSON } from "../lib/memory-tool-call";
import { withRunBudget } from "../lib/run-budget-tool";

export default withRunBudget(
  defineTool({
    description:
      "Confirm a preference you saved as inferred, only after the person says yes to remembering it. Until then " +
      "it is never used. Quote the words of their latest message.",
    label: { start: ({ key }) => `Confirming your ${String(key).replace("_", " ")}` },
    inputSchema: ConfirmFactInputSchema,
    outputSchema: MemoryToolOutputSchema,
    async execute(input, ctx) {
      const call = memoryToolCall(ctx);
      if (call === undefined) return NO_PERSON;
      const outcome = await confirmInferredFact(container().memoryDependencies, {
        ownerId: call.ownerId,
        fact: { key: input.key },
        evidence: call.evidence(input.evidence_quote),
      });
      return presentConfirmOutcome(outcome);
    },
  }),
);
