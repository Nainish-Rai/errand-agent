import { ProposeActionInputSchema, ProposeActionOutputSchema } from "@errand/contracts";
import { defineTool } from "eve/tools";

import { container } from "../../src/composition/container";
import { proposeBooking } from "../../src/core/use-cases/propose-booking";
import { presentProposeOutcome } from "../lib/approval-presenter";
import { appUserOf } from "../lib/app-user";
import { tracePlaceOf } from "../lib/trace-place";
import { withRunBudget } from "../lib/run-budget-tool";

// Shows the person the fixed approval card. It takes no terms from the model: core builds the
// proposal from the world's hold. Only the person's tap on the card's Approve button (through the
// app API, not any tool) can authorise it.
export default withRunBudget(
  defineTool({
    description:
      "Show the person the approval card for the slot you just held. The card's provider, time, price and " +
      "cancellation terms come from the hold itself, so you pass only the action. Nothing is booked until the " +
      "person taps Approve on the card; you can't approve for them.",
    label: { start: () => "Preparing the approval card" },
    inputSchema: ProposeActionInputSchema,
    outputSchema: ProposeActionOutputSchema,
    async execute(_input, ctx) {
      const userId = appUserOf(ctx.session.auth.current);
      if (userId === undefined) throw new Error("propose_action needs an authenticated session.");
      const outcome = await proposeBooking(container().proposalDependencies, { place: tracePlaceOf(ctx), userId });
      return presentProposeOutcome(outcome);
    },
  }),
);
