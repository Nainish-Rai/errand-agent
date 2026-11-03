import { ListBookingsInputSchema, ListBookingsOutputSchema } from "@errand/contracts";
import { defineTool } from "eve/tools";

import { container } from "../../src/composition/container";
import { listBookingHistory } from "../../src/core/use-cases/list-bookings";
import { appUserOf } from "../lib/app-user";
import { presentBookingHistory } from "../lib/booking-presenter";
import { withRunBudget } from "../lib/run-budget-tool";

// The assignment's list_bookings: the person's bookings as the world has them, upcoming and past.
export default withRunBudget(
  defineTool({
    description:
      "List the person's bookings: upcoming (can be cancelled or moved) and past (most recent first). Use it to find " +
      "the booking they mean (\"my AC servicing\", \"it\") and for \"the same provider as last time\".",
    label: { start: () => "Checking your bookings" },
    inputSchema: ListBookingsInputSchema,
    outputSchema: ListBookingsOutputSchema,
    async execute(_input, ctx) {
      const userId = appUserOf(ctx.session.auth.current);
      if (userId === undefined) throw new Error("list_bookings needs an authenticated session.");
      return presentBookingHistory(await listBookingHistory(container().proposalDependencies, userId));
    },
  }),
);
