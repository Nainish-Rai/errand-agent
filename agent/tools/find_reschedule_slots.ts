import { FindRescheduleSlotsInputSchema, FindRescheduleSlotsOutputSchema } from "@errand/contracts";
import { defineTool } from "eve/tools";

import { container } from "../../src/composition/container";
import { findRescheduleSlots } from "../../src/core/use-cases/find-reschedule-slots";
import { appUserOf } from "../lib/app-user";
import { presentRescheduleSlots } from "../lib/booking-presenter";
import { withRunBudget } from "../lib/run-budget-tool";

// Where a booking could move to: its provider's free slots on the dates asked. Books and moves nothing.
export default withRunBudget(
  defineTool({
    description:
      "Find the free slots an upcoming booking could move to: its own provider's, on the dates you pass. " +
      "Then call propose_action with action reschedule and one of these slots exactly as returned. Moves nothing.",
    label: { start: () => "Finding new times" },
    inputSchema: FindRescheduleSlotsInputSchema,
    outputSchema: FindRescheduleSlotsOutputSchema,
    async execute(input, ctx) {
      const userId = appUserOf(ctx.session.auth.current);
      if (userId === undefined) throw new Error("find_reschedule_slots needs an authenticated session.");
      const outcome = await findRescheduleSlots(container().proposalDependencies, {
        userId,
        bookingId: input.booking_id,
        dates: { from: input.from, to: input.to },
      });
      return presentRescheduleSlots(outcome);
    },
  }),
);
