import type { Booking, BookingStatusOutcome, CancelOutcome, Hold, RescheduleOutcome } from "../../core/ports/provider-world";
import type { ScenarioName } from "./scenarios/scenarios";

// The mock world stands in for an outside provider network, and a provider doesn't forget a
// booking (or the idempotency key that made it) because our backend crashed. So the world's state
// is saved on every change and restored at startup. Core never sees this: it talks to the world
// through the ProviderWorld port, exactly as it would to a real provider.

export interface HoldRecord extends Hold {
  consumed: boolean;
  /** The scenario's revision of the held terms has been applied (it applies once per hold). */
  revised?: boolean;
}

/** What one idempotency key committed, so a repeat returns it instead of acting again. */
export type KeyRecord =
  | { readonly operation: "book"; readonly holdId: string; readonly outcome: BookingStatusOutcome }
  | { readonly operation: "cancel"; readonly bookingId: string; readonly outcome: CancelOutcome }
  | {
      readonly operation: "reschedule";
      readonly bookingId: string;
      readonly slotStart: string;
      readonly outcome: RescheduleOutcome;
    };

export interface WorldState {
  readonly seed: number;
  readonly scenario: ScenarioName;
  readonly nextId: number;
  readonly holds: readonly HoldRecord[];
  readonly bookings: readonly Booking[];
  readonly keys: readonly (readonly [string, KeyRecord])[];
  readonly bookAttempts: readonly (readonly [string, number])[];
  readonly cancelAttempts: readonly (readonly [string, number])[];
  readonly takenSlots: readonly string[];
  /** `hold_expires_once` has let its one hold lapse (absent in state saved before it existed). */
  readonly holdLapsed?: boolean;
}

/** Saves synchronously: once `save` returns, the state is on disk. */
export interface WorldStateStore {
  save(state: WorldState): void;
  load(): WorldState | undefined;
}
