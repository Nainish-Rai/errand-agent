import { ListMemoryInputSchema, ListMemoryResponseSchema } from "@errand/contracts";
import { defineTool } from "eve/tools";

import { container } from "../../src/composition/container";
import { listMemoryFacts } from "../../src/core/use-cases/list-memory-facts";
import { memoryOwnerOf } from "../lib/memory-owner";
import { presentMemory } from "../lib/memory-presenter";
import { withRunBudget } from "../lib/run-budget-tool";

export default withRunBudget(
  defineTool({
    description:
      "List everything remembered about the person, for \"what do you remember about me?\": each fact with its " +
      "status (active, pending_confirmation, superseded, forgotten) and whether they said it or you inferred it, " +
      "plus the keys they asked you to forget. Describe the active and pending ones; say forgotten ones are gone.",
    label: { start: () => "Checking what I remember" },
    inputSchema: ListMemoryInputSchema,
    outputSchema: ListMemoryResponseSchema,
    async execute(_input, ctx) {
      const ownerId = memoryOwnerOf(ctx.session.auth.current);
      if (ownerId === undefined) return { facts: [], tombstones: [] };
      return presentMemory(await listMemoryFacts(container().memory, ownerId));
    },
  }),
);
