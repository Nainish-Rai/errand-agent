import { RememberedOutputSchema, UpdateErrandInputSchema, UpdateErrandOutputSchema, type UpdateErrandInput } from "@errand/contracts";
import { defineTool } from "eve/tools";

import { container } from "../../src/composition/container";
import type { ErrandPatchRequest } from "../../src/core/use-cases/update-errand";
import { updateErrand } from "../../src/core/use-cases/update-errand";
import { startErrandFromMemory } from "../lib/errand-memory";
import { presentUpdateOutcome } from "../lib/errand-presenter";
import { tracePlaceOf } from "../lib/trace-place";
import { withRunBudget } from "../lib/run-budget-tool";

/** The wire's snake_case fields to a core patch. A null or absent field is not part of the patch. */
function patchFrom(input: UpdateErrandInput): ErrandPatchRequest {
  const window = input.time_window ?? undefined;
  const hasHours = window?.earliest_hour != null || window?.latest_hour != null;
  return {
    ...(input.service == null ? {} : { service: input.service }),
    ...(input.area == null ? {} : { area: input.area }),
    ...(window === undefined
      ? {}
      : {
          timeWindow: {
            dates: { from: window.from, to: window.to },
            ...(hasHours ? { hours: { from: window.earliest_hour ?? 0, to: window.latest_hour ?? 24 } } : {}),
          },
        }),
    ...(input.budget_inr == null ? {} : { budget: { maxInr: input.budget_inr } }),
    ...(input.preferences == null ? {} : { preferences: input.preferences }),
  };
}

export default withRunBudget(
  defineTool({
    description:
      "Save what the person told you about their errand: service, area, time window, budget and " +
      "preferences. Send only the fields they gave or changed; every other field keeps its value. " +
      "Returns the errand, the fields still missing, and `question`: the only fields you may ask about " +
      "next, with quick replies the chat shows as tap-to-answer chips. `remembered` lists details filled in " +
      "from the person's memory; say each one's notice.",
    label: { start: () => "Noting your errand" },
    inputSchema: UpdateErrandInputSchema,
    outputSchema: UpdateErrandOutputSchema.and(RememberedOutputSchema),
    async execute(input, ctx) {
      const { errandDependencies, catalog } = container();
      const place = tracePlaceOf(ctx);
      const patch = patchFrom(input);
      const remembered = await startErrandFromMemory(ctx, place, patch);
      const outcome = await updateErrand(errandDependencies, { place, patch });
      return { ...presentUpdateOutcome(outcome, catalog), remembered };
    },
  }),
);
