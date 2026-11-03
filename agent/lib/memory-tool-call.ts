import type { MemoryToolOutput } from "@errand/contracts";

import type { MemoryEvidence } from "../../src/core/memory/memory-fact";
import { evidenceFor } from "./memory-evidence";
import { memoryOwnerOf } from "./memory-owner";

// What a memory tool reads from its call: whose memory it is (the session's signed-in caller) and
// where the quoted words come from (the conversation the model was given).

interface MemoryToolContext {
  readonly session: {
    readonly id: string;
    readonly auth: { readonly current: { readonly principalId: string; readonly principalType: string } | null };
  };
  readonly messages: readonly { readonly role: string; readonly content: unknown }[];
}

export interface MemoryToolCall {
  readonly ownerId: string;
  evidence(quote: string): MemoryEvidence;
}

export function memoryToolCall(ctx: MemoryToolContext): MemoryToolCall | undefined {
  const ownerId = memoryOwnerOf(ctx.session.auth.current);
  if (ownerId === undefined) return undefined;
  return { ownerId, evidence: (quote) => evidenceFor(quote, ctx.messages, ctx.session.id) };
}

/** With no signed-in person there is no memory to read or write. */
export const NO_PERSON: MemoryToolOutput = {
  kind: "untrusted_source",
  fact: null,
  reason: "no_signed_in_person",
  message: "Memory is off: no one is signed in.",
};
