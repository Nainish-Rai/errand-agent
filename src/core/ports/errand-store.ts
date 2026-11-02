import type { Errand } from "../errand/errand";

export interface ErrandChange<T> {
  /** The errand to save; absent leaves the store as it was. */
  readonly errand?: Errand;
  readonly result: T;
}

/** One errand per chat session. */
export interface ErrandStore {
  find(sessionId: string): Promise<Errand | undefined>;
  /**
   * Reads the session's errand, lets `change` decide what to save, and saves it. Changes to one
   * session run one at a time: the model may call two errand tools in the same step, and neither
   * may overwrite the other's patch.
   */
  change<T>(sessionId: string, change: (current: Errand | undefined) => Promise<ErrandChange<T>>): Promise<T>;
}
