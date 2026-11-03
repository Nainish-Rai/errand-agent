import type { ChatTurn } from "@errand/client";

import type { User, UserStep } from "./user";

/**
 * One person over several chat sessions: each user plays one session and sees only that session's
 * turns, the way a person coming back another day sees a fresh chat. Between them it starts a new
 * session.
 */
export class ReturningUser implements User {
  readonly #sessions: readonly User[];
  #current = 0;
  /** Where the current session's turns start. */
  #firstTurn = 0;

  constructor(sessions: readonly User[]) {
    if (sessions.length === 0) throw new Error("A returning user needs at least one session.");
    this.#sessions = sessions;
  }

  get costUsd(): number {
    return this.#sessions.reduce((total, user) => total + user.costUsd, 0);
  }

  async nextStep(turns: readonly ChatTurn[]): Promise<UserStep | undefined> {
    const user = this.#sessions[this.#current];
    if (user === undefined) return undefined;
    const step = await user.nextStep(turns.slice(this.#firstTurn));
    if (step !== undefined) return step;
    this.#current += 1;
    if (this.#current >= this.#sessions.length) return undefined;
    this.#firstTurn = turns.length;
    return { newSession: true };
  }
}
