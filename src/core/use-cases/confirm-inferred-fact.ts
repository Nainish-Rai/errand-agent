import { isPersonsOwnRequest, type MemoryEvidence, type MemoryFact, type MemoryKey } from "../memory/memory-fact";
import type { MemoryDependencies } from "./memory-session";

// The person confirms a guess ("yes, that's my usual area"), so the agent may use it from now on.
// The fact keeps its value and its inferred source; it becomes active and records the confirmation.

/** A pending fact by its id (the Memory panel) or by its key (the chat). */
export type FactSelector = { readonly id: string } | { readonly key: MemoryKey };

export interface ConfirmInferredFactRequest {
  readonly ownerId: string;
  readonly fact: FactSelector;
  /** The person's latest message or their click. */
  readonly evidence: MemoryEvidence;
}

export type ConfirmInferredFactOutcome =
  | { readonly kind: "confirmed"; readonly fact: MemoryFact }
  | { readonly kind: "not_found" }
  /** It isn't waiting for confirmation (already active, superseded or forgotten). */
  | { readonly kind: "not_pending"; readonly fact: MemoryFact }
  | { readonly kind: "untrusted_source"; readonly reason: "not_the_persons_request" };

function matches(fact: MemoryFact, selector: FactSelector): boolean {
  return "id" in selector ? fact.id === selector.id : fact.key === selector.key && fact.status === "pending_confirmation";
}

export function confirmInferredFact(deps: MemoryDependencies, request: ConfirmInferredFactRequest): Promise<ConfirmInferredFactOutcome> {
  const { evidence } = request;
  if (!isPersonsOwnRequest(evidence)) return Promise.resolve({ kind: "untrusted_source", reason: "not_the_persons_request" });

  return deps.memory.change<ConfirmInferredFactOutcome>(request.ownerId, (memory) => {
    const fact = memory.facts.find((candidate) => matches(candidate, request.fact));
    if (fact === undefined) return { save: [], tombstones: [], result: { kind: "not_found" } };
    if (fact.status !== "pending_confirmation") return { save: [], tombstones: [], result: { kind: "not_pending", fact } };
    const confirmed: MemoryFact = { ...fact, status: "active", confirmation: { atMs: deps.clock.now().getTime(), evidence } };
    return { save: [confirmed], tombstones: [], result: { kind: "confirmed", fact: confirmed } };
  });
}
