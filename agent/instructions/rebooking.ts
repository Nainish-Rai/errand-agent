import { defineDynamic, defineInstructions } from "eve/instructions";

import { container } from "../../src/composition/container";
import { presentRebookingInstructions } from "../lib/provider-update-presenter";

// A chat whose errand replaces a booking a provider cancelled (ticket 14) gets its instructions
// here, only while that errand is open: the search to run (from the errand core prefilled with the
// person's saved preferences) and the provider that is excluded. Other chats pay nothing for it.

export default defineDynamic(async (ctx) => {
  if (ctx.turn === null || ctx.session.parent != null) return null;
  const errand = await container().errands.find(ctx.session.id);
  const content = errand === undefined ? undefined : presentRebookingInstructions(errand);
  return content === undefined ? null : defineInstructions({ content });
});
