import { ProposeActionInputSchema, ProposeActionOutputSchema } from "@errand/contracts";
import { defineTool } from "eve/tools";

import { container } from "../../src/composition/container";
import { proposeBooking } from "../../src/core/use-cases/propose-booking";
import { proposeCancellation, proposeReschedule } from "../../src/core/use-cases/propose-booking-change";
import { presentMissingChangeDetails, presentProposeChangeOutcome, presentProposeOutcome } from "../lib/approval-presenter";
import { appUserOf } from "../lib/app-user";
import { tracePlaceOf } from "../lib/trace-place";
import { withRunBudget } from "../lib/run-budget-tool";

// Shows the person the fixed approval card. It takes no terms from the model: core builds the
// proposal from the world's hold (a booking) or the world's booking and the provider's rule (a
// cancellation or a reschedule). Only the person's tap on the card's Approve button (through the
// app API, not any tool) can authorise it.
export default withRunBudget(
  defineTool({
    description:
      "Show the person the approval card. book: for the slot you just held. cancel: for an upcoming booking " +
      "(booking_id from list_bookings); the card shows any fee. reschedule: move an upcoming booking to a slot from " +
      "find_reschedule_slots; the card shows the old time next to the new one. Every term on the card comes from the " +
      "world. Nothing happens until the person taps Approve on the card; you can't approve for them.",
    label: { start: ({ action }) => (action === "book" ? "Preparing the approval card" : `Preparing the ${action} card`) },
    inputSchema: ProposeActionInputSchema,
    outputSchema: ProposeActionOutputSchema,
    async execute(input, ctx) {
      const userId = appUserOf(ctx.session.auth.current);
      if (userId === undefined) throw new Error("propose_action needs an authenticated session.");
      const { proposalDependencies } = container();
      const place = tracePlaceOf(ctx);
      const bookingId = input.booking_id ?? undefined;
      const slot = input.slot ?? undefined;
      switch (input.action) {
        case "book":
          return presentProposeOutcome(await proposeBooking(proposalDependencies, { place, userId }));
        case "cancel":
          if (bookingId === undefined) return presentMissingChangeDetails(["booking_id"]);
          return presentProposeChangeOutcome(await proposeCancellation(proposalDependencies, { place, userId, bookingId }));
        case "reschedule": {
          const missing = [...(bookingId === undefined ? ["booking_id" as const] : []), ...(slot === undefined ? ["slot" as const] : [])];
          if (bookingId === undefined || slot === undefined) return presentMissingChangeDetails(missing);
          return presentProposeChangeOutcome(await proposeReschedule(proposalDependencies, { place, userId, bookingId, slot }));
        }
      }
    },
  }),
);
