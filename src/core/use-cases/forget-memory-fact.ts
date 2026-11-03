import { closed, isPersonsOwnRequest, tombstoneFor, type MemoryEvidence, type MemoryKey, type Tombstone } from "../memory/memory-fact";
import type { MemoryDependencies } from "./memory-session";

// "Forget my technician": every fact of the key is marked forgotten (its validity window closes
// now if it was still open) and a tombstone is written. The tombstone is what stops the agent from
// guessing the key again from old history; only the person saying it again can bring it back.

export interface ForgetMemoryFactRequest {
  readonly ownerId: string;
  readonly key: MemoryKey;
  /** The person's latest message or their click. Nothing else can make the agent forget. */
  readonly evidence: MemoryEvidence;
}

export type ForgetMemoryFactOutcome =
  | { readonly kind: "forgotten"; readonly key: MemoryKey; readonly tombstone: Tombstone; readonly closedFacts: number }
  /** Already forgotten, and nothing remembered for the key since. */
  | { readonly kind: "already_forgotten"; readonly key: MemoryKey; readonly tombstone: Tombstone }
  | { readonly kind: "untrusted_source"; readonly reason: "not_the_persons_request" };

export function forgetMemoryFact(deps: MemoryDependencies, request: ForgetMemoryFactRequest): Promise<ForgetMemoryFactOutcome> {
  const { evidence } = request;
  if (!isPersonsOwnRequest(evidence)) return Promise.resolve({ kind: "untrusted_source", reason: "not_the_persons_request" });

  return deps.memory.change<ForgetMemoryFactOutcome>(request.ownerId, (memory) => {
    const atMs = deps.clock.now().getTime();
    // Superseded facts are marked forgotten too, so no old value of the key reads as anything but a tombstone.
    const remaining = memory.facts.filter((fact) => fact.key === request.key && fact.status !== "forgotten");
    const existing = tombstoneFor(memory, request.key);
    if (remaining.length === 0 && existing !== undefined) {
      return { save: [], tombstones: [], result: { kind: "already_forgotten", key: request.key, tombstone: existing } };
    }
    const tombstone: Tombstone = { ownerId: request.ownerId, key: request.key, forgottenAtMs: atMs, evidence };
    const closedFacts = remaining.filter((fact) => fact.status === "active" || fact.status === "pending_confirmation").length;
    return {
      save: remaining.map((fact) => closed(fact, "forgotten", atMs)),
      tombstones: [tombstone],
      result: { kind: "forgotten", key: request.key, tombstone, closedFacts },
    };
  });
}
