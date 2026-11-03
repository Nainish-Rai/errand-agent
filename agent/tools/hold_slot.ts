import { HoldSlotInputSchema, HoldSlotOutputSchema } from "@errand/contracts";
import { defineTool } from "eve/tools";

import { container } from "../../src/composition/container";
import { holdSlot } from "../../src/core/use-cases/hold-slot";
import { presentHoldOutcome } from "../lib/approval-presenter";
import { tracePlaceOf } from "../lib/trace-place";
import { withRunBudget } from "../lib/run-budget-tool";

// The assignment's hold_slot. Holding reserves the slot for a few minutes and books nothing.
export default withRunBudget(
  defineTool({
    description:
      "Hold the slot of the option the person chose, so nobody else takes it while they look at the approval card. " +
      "Pass the option's providerId and one of its slots exactly as search_providers returned them. " +
      "Holding books nothing. Then call propose_action.",
    label: { start: () => "Holding the slot" },
    inputSchema: HoldSlotInputSchema,
    outputSchema: HoldSlotOutputSchema,
    async execute(input, ctx) {
      const { proposalDependencies, catalog } = container();
      const outcome = await holdSlot(proposalDependencies, { place: tracePlaceOf(ctx), providerId: input.provider_id, slot: input.slot });
      return presentHoldOutcome(outcome, catalog);
    },
  }),
);
