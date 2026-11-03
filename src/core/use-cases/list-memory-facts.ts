import type { OwnerMemory } from "../memory/memory-fact";
import type { MemoryStore } from "../ports/memory-store";

/** Everything remembered about the person: current, pending, superseded and forgotten facts, and tombstones. */
export function listMemoryFacts(memory: MemoryStore, ownerId: string): Promise<OwnerMemory> {
  return memory.read(ownerId);
}
