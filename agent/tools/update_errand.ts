import { UpdateErrandInputSchema, UpdateErrandOutputSchema, type UpdateErrandInput } from "@errand/contracts";
import { defineTool } from "eve/tools";

import { container } from "../../src/composition/container";
import type { ErrandPatchRequest } from "../../src/core/use-cases/update-errand";
import { updateErrand } from "../../src/core/use-cases/update-errand";
import { presentUpdateOutcome } from "../lib/errand-presenter";
import { tracePlaceOf } from "../lib/trace-place";

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

export default defineTool({
  description:
    "Save what the person told you about their errand: service, area, time window, budget and " +
    "preferences. Send only the fields they gave or changed; every other field keeps its value. " +
    "Returns the errand, the fields still missing, and `question`: the only fields you may ask about " +
    "next, with quick replies the chat shows as tap-to-answer chips.",
  label: { start: () => "Noting your errand" },
  inputSchema: UpdateErrandInputSchema,
  outputSchema: UpdateErrandOutputSchema,
  async execute(input, ctx) {
    const { errandDependencies, catalog } = container();
    const outcome = await updateErrand(errandDependencies, { place: tracePlaceOf(ctx), patch: patchFrom(input) });
    return presentUpdateOutcome(outcome, catalog);
  },
});
