import type { Clock } from "../ports/clock";
import type { MemoryStore } from "../ports/memory-store";
import type { ServiceCatalog } from "../ports/service-catalog";

// What every memory use case works with: the store, the catalog that names valid areas, and the
// clock that opens and closes validity windows.

export interface MemoryDependencies {
  readonly memory: MemoryStore;
  readonly catalog: ServiceCatalog;
  readonly clock: Clock;
}
