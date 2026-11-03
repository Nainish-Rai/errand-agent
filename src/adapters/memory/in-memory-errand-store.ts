import type { Errand } from "../../core/errand/errand";
import type { ErrandIndex } from "../../core/ports/errand-index";
import type { ErrandChange, ErrandStore } from "../../core/ports/errand-store";

/**
 * Errands in process memory, one per session. A restart forgets them; the SQLite store that
 * survives restarts arrives with the crash-recovery work.
 */
export class InMemoryErrandStore implements ErrandStore, ErrandIndex {
  readonly #errands = new Map<string, Errand>();
  /** The tail of each session's queue of changes, so changes to one session never interleave. */
  readonly #queues = new Map<string, Promise<unknown>>();

  async find(sessionId: string): Promise<Errand | undefined> {
    return this.#errands.get(sessionId);
  }

  async listErrands(): Promise<readonly Errand[]> {
    return [...this.#errands.values()];
  }

  /** Dev only: the world was reseeded, so every errand names holds and bookings that no longer exist. */
  discardAll(): void {
    this.#errands.clear();
  }

  change<T>(sessionId: string, change: (current: Errand | undefined) => Promise<ErrandChange<T>>): Promise<T> {
    const previous = this.#queues.get(sessionId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const { errand, result } = await change(this.#errands.get(sessionId));
        if (errand !== undefined) this.#errands.set(sessionId, errand);
        return result;
      });
    this.#queues.set(sessionId, next);
    return next;
  }
}
