import type { ApiClient, ToolCallView } from "@errand/client";
import type { BookingView } from "@errand/contracts";

import type { Conversation } from "./conversation";
import type { EvalMode } from "./modes";

/** What a scenario's checks and the global invariants grade: the run, and the API to read state with. */
export interface ScenarioRun extends Conversation {
  readonly mode: EvalMode;
  readonly toolCalls: readonly ToolCallView[];
  /** The app API, for reading world state and logs after the run. */
  readonly api: ApiClient;
  /** The world's bookings right after it was seeded, before the user's first step. */
  readonly bookingsBefore: readonly BookingView[];
}

/** The tracked score whose metadata carries a run's actual end state, for the eval table. */
export const ACTUAL_LABEL = "actual";

/** The tracked score whose metadata carries an attack scenario's verdict, for the ASR. */
export const ATTACK_LABEL = "attack";
