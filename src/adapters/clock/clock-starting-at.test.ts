import { describe, expect, it } from "vitest";

import { clockStartingAt, InvalidClockStartError } from "./clock-starting-at";

function manualClock(startMs: number) {
  let nowMs = startMs;
  return { now: () => new Date(nowMs), advance: (ms: number) => (nowMs += ms) };
}

describe("a clock pinned to a start", () => {
  it("reads the start first, whatever the real date is", () => {
    const real = manualClock(Date.parse("2031-02-17T22:10:00Z"));
    const clock = clockStartingAt("2026-11-04T09:00:00+05:30", real);
    expect(clock.now().toISOString()).toBe("2026-11-04T03:30:00.000Z");
  });

  it("keeps moving forward in real time", () => {
    const real = manualClock(0);
    const clock = clockStartingAt("2026-11-04T09:00:00+05:30", real);
    real.advance(90_000);
    expect(clock.now().toISOString()).toBe("2026-11-04T03:31:30.000Z");
  });

  it("refuses a start that is not an instant", () => {
    expect(() => clockStartingAt("next tuesday", manualClock(0))).toThrow(InvalidClockStartError);
  });
});
