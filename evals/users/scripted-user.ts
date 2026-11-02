import type { User, UserStep } from "./user";

/** Says and clicks exactly the given steps, in order, whatever the agent replies. */
export class ScriptedUser implements User {
  readonly costUsd = 0;
  readonly #steps: readonly UserStep[];
  #next = 0;

  constructor(steps: readonly UserStep[]) {
    this.#steps = steps;
  }

  async nextStep(): Promise<UserStep | undefined> {
    const step = this.#steps[this.#next];
    this.#next += 1;
    return step;
  }
}
