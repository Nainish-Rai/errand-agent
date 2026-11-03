import type { RememberedDetail } from "@errand/contracts";

import { container } from "../../src/composition/container";
import type { TracePlace } from "../../src/core/errand/errand-workflow";
import { prefillErrandFromMemory } from "../../src/core/use-cases/prefill-errand-from-memory";
import type { ErrandPatchRequest } from "../../src/core/use-cases/update-errand";
import { personsMessages, type MessageLike } from "./memory-evidence";
import { memoryOwnerOf } from "./memory-owner";
import { presentRemembered } from "./memory-presenter";

// The errand tools start a new errand from memory before they apply what the person said, so
// "a plumber this week" gets the usual area without asking. Returns what memory filled in, with
// the sentence the agent says for each; empty when nothing was used.

interface ErrandToolContext {
  readonly messages: readonly MessageLike[];
  readonly session: { readonly auth: { readonly current: { readonly principalId: string; readonly principalType: string } | null } };
}

export async function startErrandFromMemory(
  ctx: ErrandToolContext,
  place: TracePlace,
  setting: ErrandPatchRequest,
): Promise<RememberedDetail[]> {
  const ownerId = memoryOwnerOf(ctx.session.auth.current);
  if (ownerId === undefined) return [];
  const { errandDependencies, memoryDependencies } = container();
  const outcome = await prefillErrandFromMemory({ errand: errandDependencies, memory: memoryDependencies }, {
    ownerId,
    place,
    setting,
    personsWords: personsMessages(ctx.messages),
  });
  return presentRemembered(outcome);
}
