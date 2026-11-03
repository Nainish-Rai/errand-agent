import { ErrandSearchOutputSchema, RememberedOutputSchema, SearchProvidersInputSchema } from "@errand/contracts";
import { defineTool } from "eve/tools";

import { container } from "../../src/composition/container";
import { findErrandOptions } from "../../src/core/use-cases/find-errand-options";
import { startErrandFromMemory } from "../lib/errand-memory";
import { presentFindOutcome } from "../lib/errand-presenter";
import { tracePlaceOf } from "../lib/trace-place";
import { withRunBudget } from "../lib/run-budget-tool";

// The tool name comes from the filename: the model sees `search_providers`, the assignment's name.
// It searches for the session's errand: the arguments are written to the errand first, and core
// drops every provider outside the errand's budget or time window before the model sees them.
export default withRunBudget(
  defineTool({
    description:
      "Search providers for the errand and get two or three options tagged best_match, cheapest and " +
      "earliest. The service, area and date range you pass are saved to the errand; the errand's budget " +
      "and hours are applied in code, so every provider returned fits them. Show the options, not the full list.",
    label: { start: ({ service, area }) => `Searching ${service} in ${area}` },
    inputSchema: SearchProvidersInputSchema,
    outputSchema: ErrandSearchOutputSchema.and(RememberedOutputSchema),
    async execute(input, ctx) {
      const { errandDependencies, catalog } = container();
      const place = tracePlaceOf(ctx);
      // A search names the service, area and dates itself; memory can still bring the budget and
      // preferences, and the area when the search passes on the remembered one.
      const remembered = await startErrandFromMemory(ctx, place, {
        service: input.service,
        area: input.area,
        timeWindow: { dates: input.date_range },
      });
      const outcome = await findErrandOptions(errandDependencies, {
        place,
        search: { service: input.service, area: input.area, dates: input.date_range },
      });
      return { ...presentFindOutcome(outcome, catalog), remembered };
    },
  }),
);
