import type { ApiClient, ToolCallView } from "@errand/client";
import type { BookingView, SwitchScenarioRequest } from "@errand/contracts";

import type { Conversation } from "./conversation";
import type { EvalMode } from "./modes";

/** What a scenario's checks and the global invariants grade: the run, and the API to read state with. */
export interface ScenarioRun extends Conversation {
  readonly mode: EvalMode;
  readonly toolCalls: readonly ToolCallView[];
  /** The app API as the person who chatted, for reading world state after the run. */
  readonly api: ApiClient;
  /** The app API as an operator: the only caller the trace and context log routes answer. */
  readonly operatorApi: ApiClient;
  /** The world's bookings right after it was seeded, before the user's first step. */
  readonly bookingsBefore: readonly BookingView[];
  /** The seeded world the run played in: the truth generated UI is checked against. */
  readonly world: SwitchScenarioRequest;
  /** The server clock's start (ERRAND_CLOCK_START) for this mode. */
  readonly clockStart: string;
}

/** The tracked score whose metadata carries a run's actual end state, for the eval table. */
export const ACTUAL_LABEL = "actual";

/** The tracked score whose metadata carries an attack scenario's verdict, for the ASR. */
export const ATTACK_LABEL = "attack";
