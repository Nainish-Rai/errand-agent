import type { ProviderWorld } from "../../core/ports/provider-world";

// Dev only: a world whose one named operation is slow or throws something nobody planned for, so
// the evals and the browser checks can prove a run stops on time and fails cleanly. Or one whose
// operation runs (the world commits it) and then never answers, so the restart eval can kill the
// backend between sending `book` and recording its reply. The composition root wraps the world in
// it only after the dev-only world-fault route asked for it; production never builds one.

// Listing service options is a static menu, not a provider call that can time out, so it takes no fault.
export type WorldOperation = Exclude<keyof ProviderWorld, "listServiceOptions">;

export const WORLD_OPERATIONS: readonly WorldOperation[] = [
  "searchProviders",
  "getProvider",
  "listBookings",
  "holdSlot",
  "releaseHold",
  "getHold",
  "book",
  "getBookingStatus",
  "cancel",
  "reschedule",
];

export type WorldFault =
  | { readonly kind: "slow"; readonly operation: WorldOperation; readonly delayMs: number }
  | { readonly kind: "throw"; readonly operation: WorldOperation }
  /** The operation takes effect in the world, and its reply is held until the fault is cleared. */
  | { readonly kind: "pause_after"; readonly operation: WorldOperation };

/** The calls a `pause_after` fault is holding, so a harness knows the moment to kill the process. */
export class WorldPause {
  #paused = 0;
  #waiting: (() => void)[] = [];

  /** How many calls have reached the pause since the process started. */
  get paused(): number {
    return this.#paused;
  }

  hold(): Promise<void> {
    this.#paused += 1;
    return new Promise((resolve) => this.#waiting.push(resolve));
  }

  /** Lets every held reply through (the fault was cleared). */
  releaseAll(): void {
    for (const resume of this.#waiting.splice(0)) resume();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The kind of error a bug throws: no outcome, no code, nothing a caller knows how to handle. */
function unexpectedError(operation: WorldOperation): TypeError {
  return new TypeError(`Cannot read properties of undefined (reading '${operation}') [injected world fault]`);
}

export function faultyWorld(world: ProviderWorld, fault: WorldFault, pause: WorldPause): ProviderWorld {
  const real = (args: unknown[]) => (world[fault.operation] as (...inner: unknown[]) => Promise<unknown>).apply(world, args);
  const faulted = async (...args: unknown[]): Promise<unknown> => {
    switch (fault.kind) {
      case "throw":
        throw unexpectedError(fault.operation);
      case "slow":
        await sleep(fault.delayMs);
        return real(args);
      case "pause_after": {
        const result = await real(args);
        await pause.hold();
        return result;
      }
    }
  };
  return new Proxy(world, {
    get(target, property, receiver) {
      if (property === fault.operation) return faulted;
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? (value as (...inner: unknown[]) => unknown).bind(target) : value;
    },
  });
}
