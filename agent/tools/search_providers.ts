import { ErrandSearchOutputSchema, SearchProvidersInputSchema } from "@errand/contracts";
import { defineTool } from "eve/tools";

import { container } from "../../src/composition/container";
import { findErrandOptions } from "../../src/core/use-cases/find-errand-options";
import { presentFindOutcome } from "../lib/errand-presenter";
import { tracePlaceOf } from "../lib/trace-place";

// The tool name comes from the filename: the model sees `search_providers`, the assignment's name.
// It searches for the session's errand: the arguments are written to the errand first, and core
// drops every provider outside the errand's budget or time window before the model sees them.
export default defineTool({
  description:
    "Search providers for the errand and get two or three options tagged best_match, cheapest and " +
    "earliest. The service, area and date range you pass are saved to the errand; the errand's budget " +
    "and hours are applied in code, so every provider returned fits them. Show the options, not the full list.",
  label: { start: ({ service, area }) => `Searching ${service} in ${area}` },
  inputSchema: SearchProvidersInputSchema,
  outputSchema: ErrandSearchOutputSchema,
  async execute(input, ctx) {
    const { errandDependencies, catalog } = container();
    const outcome = await findErrandOptions(errandDependencies, {
      place: tracePlaceOf(ctx),
      search: { service: input.service, area: input.area, dates: input.date_range },
    });
    return presentFindOutcome(outcome, catalog);
  },
});
