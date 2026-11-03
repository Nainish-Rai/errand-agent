import { CorrectFactInputSchema, MemoryToolOutputSchema } from "@errand/contracts";
import { defineTool } from "eve/tools";

import { container } from "../../src/composition/container";
import { correctMemoryFact } from "../../src/core/use-cases/correct-memory-fact";
import { presentCorrectOutcome } from "../lib/memory-presenter";
import { memoryToolCall, NO_PERSON } from "../lib/memory-tool-call";
import { withRunBudget } from "../lib/run-budget-tool";

export default withRunBudget(
  defineTool({
    description:
      "Change a remembered preference when the person corrects it (\"actually my area is HSR\"). The old value " +
      "is kept as superseded and is never used again. Quote the words of their latest message.",
    label: { start: ({ key }) => `Updating your ${String(key).replace("_", " ")}` },
    inputSchema: CorrectFactInputSchema,
    outputSchema: MemoryToolOutputSchema,
    async execute(input, ctx) {
      const call = memoryToolCall(ctx);
      if (call === undefined) return NO_PERSON;
      const outcome = await correctMemoryFact(container().memoryDependencies, {
        ownerId: call.ownerId,
        key: input.key,
        value: input.value,
        evidence: call.evidence(input.evidence_quote),
      });
      return presentCorrectOutcome(outcome);
    },
  }),
);
