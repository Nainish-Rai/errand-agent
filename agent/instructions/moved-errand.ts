import { defineDynamic, defineInstructions } from "eve/instructions";

import { container } from "../../src/composition/container";
import { presentMovedErrandInstructions } from "../lib/handoff-presenter";

// A chat started from a New errand card (ticket 24) gets its instructions here, only while its
// errand is still being gathered: the details the card carried over, so the agent asks for none of
// them. Other chats pay nothing for it.

export default defineDynamic(async (ctx) => {
  if (ctx.turn === null || ctx.session.parent != null) return null;
  const { errandHandoffs, errands } = container();
  if ((await errandHandoffs.startedIn(ctx.session.id)) === undefined) return null;
  const errand = await errands.find(ctx.session.id);
  const content = errand === undefined ? undefined : presentMovedErrandInstructions(errand);
  return content === undefined ? null : defineInstructions({ content });
});
