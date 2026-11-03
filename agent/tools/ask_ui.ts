import { GeneratedUiToolInputSchema, GeneratedUiToolOutputSchema } from "@errand/contracts";
import { defineTool } from "eve/tools";

import { container } from "../../src/composition/container";
import { askWithGeneratedUi } from "../../src/core/use-cases/ask-with-generated-ui";
import { appUserOf } from "../lib/app-user";
import { presentAskedUi } from "../lib/generated-ui-presenter";
import { tracePlaceOf } from "../lib/trace-place";
import { withRunBudget } from "../lib/run-budget-tool";

// OpenUI's "ask" surface as an eve tool. It doesn't pause the turn (eve's ctx.ask() would): the
// turn ends and the person's answer arrives as their next ordinary message, so an answer such as
// "approve" goes through the same checks as typed text and can never mint a grant.
export default withRunBudget(
  defineTool({
    description:
      "Ask the person something with a small interface in the chat, written in OpenUI Lang: AskForm for the errand's missing " +
      "details, SlotPicker, PickOne or BookingPicker. Their answer comes back as their next message; end your turn after this.",
    label: { start: () => "Preparing a quick question" },
    inputSchema: GeneratedUiToolInputSchema,
    outputSchema: GeneratedUiToolOutputSchema,
    async execute(input, ctx) {
      const userId = appUserOf(ctx.session.auth.current);
      if (userId === undefined) throw new Error("Generated UI needs an authenticated session.");
      const verdict = await askWithGeneratedUi(container().generatedUiDependencies, { place: tracePlaceOf(ctx), userId, program: input.ui });
      return presentAskedUi(verdict);
    },
  }),
);
