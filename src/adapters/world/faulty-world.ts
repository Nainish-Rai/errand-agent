import type { ProviderWorld } from "../../core/ports/provider-world";

// Dev only: a world whose one named operation is slow or throws something nobody planned for, so
// the evals and the browser checks can prove a run stops on time and fails cleanly. The
// composition root wraps the world in it only after the dev-only world-fault route asked for it;
// production never builds one.

export type WorldOperation = keyof ProviderWorld;

export const WORLD_OPERATIONS: readonly WorldOperation[] = [
  "searchProviders",
  "getProvider",
  "listBookings",
  "holdSlot",
  "releaseHold",
  "book",
  "getBookingStatus",
  "cancel",
  "reschedule",
];

export type WorldFault =
  | { readonly kind: "slow"; readonly operation: WorldOperation; readonly delayMs: number }
  | { readonly kind: "throw"; readonly operation: WorldOperation };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The kind of error a bug throws: no outcome, no code, nothing a caller knows how to handle. */
function unexpectedError(operation: WorldOperation): TypeError {
  return new TypeError(`Cannot read properties of undefined (reading '${operation}') [injected world fault]`);
}

export function faultyWorld(world: ProviderWorld, fault: WorldFault): ProviderWorld {
  const faulted = async (...args: unknown[]): Promise<unknown> => {
    if (fault.kind === "throw") throw unexpectedError(fault.operation);
    await sleep(fault.delayMs);
    return (world[fault.operation] as (...inner: unknown[]) => Promise<unknown>).apply(world, args);
  };
  return new Proxy(world, {
    get(target, property, receiver) {
      if (property === fault.operation) return faulted;
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? (value as (...inner: unknown[]) => unknown).bind(target) : value;
    },
  });
}
