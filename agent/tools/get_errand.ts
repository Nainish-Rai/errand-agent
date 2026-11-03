import { GetErrandInputSchema, GetErrandOutputSchema } from "@errand/contracts";
import { defineTool } from "eve/tools";

import { container } from "../../src/composition/container";
import { getErrand } from "../../src/core/use-cases/get-errand";
import { presentErrand } from "../lib/errand-presenter";

export default defineTool({
  description:
    "Read the errand as it stands: its details, its workflow state, the fields still missing and what to ask next. " +
    "Null when the person hasn't asked for anything yet.",
  label: { start: () => "Checking the errand" },
  inputSchema: GetErrandInputSchema,
  outputSchema: GetErrandOutputSchema,
  async execute(_input, ctx) {
    const { errands, catalog } = container();
    const errand = await getErrand(errands, ctx.session.id);
    return { errand: errand === undefined ? null : presentErrand(errand, catalog) };
  },
});
