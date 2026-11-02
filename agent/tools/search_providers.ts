import { SearchProvidersInputSchema, SearchProvidersOutputSchema } from "@errand/contracts";
import { defineTool } from "eve/tools";

import { container } from "../../src/composition/container";
import { searchProviders } from "../../src/core/use-cases/search-providers";
import { presentSearchOutcome } from "../lib/world-presenter";

// The tool name comes from the filename: the model sees `search_providers`, the assignment's name.
export default defineTool({
  description:
    "Search home-service providers in a Bengaluru area for a date range. Returns 3 to 8 providers " +
    "with id, price in ₹, rating, free one-hour slots (IST) and attributes.",
  label: { start: ({ service, area }) => `Searching ${service} in ${area}` },
  inputSchema: SearchProvidersInputSchema,
  outputSchema: SearchProvidersOutputSchema,
  async execute(input) {
    const outcome = await searchProviders(container().world, {
      service: input.service,
      area: input.area,
      dateRange: input.date_range,
    });
    return presentSearchOutcome(outcome);
  },
});
