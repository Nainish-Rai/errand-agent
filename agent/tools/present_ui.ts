import { GeneratedUiToolInputSchema, GeneratedUiToolOutputSchema } from "@errand/contracts";
import { defineTool } from "eve/tools";

import { container } from "../../src/composition/container";
import { presentGeneratedUi } from "../../src/core/use-cases/present-generated-ui";
import { appUserOf } from "../lib/app-user";
import { presentShownUi } from "../lib/generated-ui-presenter";
import { tracePlaceOf } from "../lib/trace-place";
import { withRunBudget } from "../lib/run-budget-tool";

// OpenUI's "present" surface as an eve tool. OpenUI's assistant-ui integration registers its
// tools in the browser, but eve's tools are defined on the server, so this tool takes the same
// `{ ui }` argument and core judges the program here; the chat renders it with OpenUI only when
// the verdict says it may (docs/notes/openui-spike.md).
export default withRunBudget(
  defineTool({
    description:
      "Show the person a small interface in the chat, written in OpenUI Lang with the generated-UI components: choice cards, " +
      "charts, provider details, next-step chips. Components take ids; the chat fills in prices, ratings and slots from the world.",
    label: { start: () => "Laying it out" },
    inputSchema: GeneratedUiToolInputSchema,
    outputSchema: GeneratedUiToolOutputSchema,
    async execute(input, ctx) {
      const userId = appUserOf(ctx.session.auth.current);
      if (userId === undefined) throw new Error("Generated UI needs an authenticated session.");
      const verdict = await presentGeneratedUi(container().generatedUiDependencies, { place: tracePlaceOf(ctx), userId, program: input.ui });
      return presentShownUi(verdict);
    },
  }),
);
