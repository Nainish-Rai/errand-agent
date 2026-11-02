import type { Clock } from "../../core/ports/clock";

export class InvalidClockStartError extends Error {
  constructor(value: string) {
    super(`ERRAND_CLOCK_START must be an ISO 8601 instant such as 2026-11-04T09:00:00+05:30; got "${value}".`);
    this.name = "InvalidClockStartError";
  }
}

/**
 * A clock that reads `start` when it is made and then moves forward in real time. Evals pin the
 * start so "this week" and the seeded slots are the same on any day, and a recorded run replays
 * against the world it was recorded in; hold expiry and latency still see time pass.
 */
export function clockStartingAt(start: string, realClock: Clock): Clock {
  const startMs = Date.parse(start);
  if (Number.isNaN(startMs)) throw new InvalidClockStartError(start);
  const madeAtMs = realClock.now().getTime();
  return { now: () => new Date(startMs + (realClock.now().getTime() - madeAtMs)) };
}
