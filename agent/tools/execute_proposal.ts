import { ExecuteProposalInputSchema, ExecuteProposalOutputSchema } from "@errand/contracts";
import { defineTool } from "eve/tools";

import { container } from "../../src/composition/container";
import { executeProposal } from "../../src/core/use-cases/execute-proposal";
import { presentExecuteOutcome } from "../lib/approval-presenter";
import { tracePlaceOf } from "../lib/trace-place";

// The model's only way to a booking, and core refuses it without a grant from a tap on the card.
// There is no book, cancel or reschedule tool.
export default defineTool({
  description:
    "Carry out the approval card's booking. Call it whenever the person says to go ahead, by tapping or typing. " +
    "It books only if they tapped Approve on the card; otherwise it books nothing and the card is shown again. " +
    "Relay its message: say Booked only when it returns booked, with the booking ID.",
  label: { start: () => "Booking with the provider" },
  inputSchema: ExecuteProposalInputSchema,
  outputSchema: ExecuteProposalOutputSchema,
  async execute(_input, ctx) {
    const outcome = await executeProposal(container().proposalDependencies, { place: tracePlaceOf(ctx) });
    return presentExecuteOutcome(outcome);
  },
});
