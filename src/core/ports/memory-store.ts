import type { MemoryFact, OwnerMemory, Tombstone } from "../memory/memory-fact";

export interface MemoryChange<T> {
  /** Facts to insert, or to update by id. A stored fact's key, value and evidence never change. */
  readonly save: readonly MemoryFact[];
  readonly tombstones: readonly Tombstone[];
  readonly result: T;
}

/** Memory facts and tombstones, per person. */
export interface MemoryStore {
  read(ownerId: string): Promise<OwnerMemory>;
  /**
   * Reads the person's memory, lets `change` decide what to write, and writes it atomically. Changes
   * to one person's memory run one at a time.
   */
  change<T>(ownerId: string, change: (memory: OwnerMemory) => MemoryChange<T>): Promise<T>;
  /** Dev only: replaces everything stored about the person (evals seed memory per scenario). */
  replace(ownerId: string, memory: OwnerMemory): Promise<void>;
  /** A new, unique fact id. */
  newFactId(): string;
}
