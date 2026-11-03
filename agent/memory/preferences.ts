import { defineMemory, defineMemoryProvider } from "eve/memory";
import { byPrincipal } from "eve/memory/scope";

import { container } from "../../src/composition/container";
import { buildModelContext } from "../../src/core/use-cases/build-model-context";
import { memoryOwnerOf } from "../lib/memory-owner";
import { renderMemoryContext } from "../lib/memory-presenter";

// The person's remembered preferences, recalled before each turn's first model call. Core's context
// selection decides what goes in (only active facts: explicit, or inferred and confirmed, ranked
// and packed into the memory share of the context budget), and every
// turn's selection is written to the run trace with what was left out and why. The model writes
// memory only through the remember, correct, forget and confirm tools, never through capture.

/** One stable id, so each turn's recall replaces the last instead of piling up copies. */
const RECALL_ID = "errand-preferences";

const preferences = defineMemoryProvider({
  recall: {
    async "turn.started"(ctx) {
      const ownerId = memoryOwnerOf(ctx.session.auth.current);
      if (ownerId === undefined) return null;
      const context = await buildModelContext(container().modelContextDependencies, {
        ownerId,
        place: { traceId: ctx.session.parent?.rootSessionId ?? ctx.session.id, sessionId: ctx.session.id },
        turnId: ctx.turn.id,
        render: renderMemoryContext,
      });
      // A person nothing was ever stored about gets no memory message at all.
      if (!context.remembersAnything) return null;
      return { messages: [{ id: RECALL_ID, content: context.text }] };
    },
  },
});

export default defineMemory({
  description: "The person's saved errand preferences: usual area, budget, earliest start, favourite technician.",
  provider: preferences,
  scope: byPrincipal,
});
