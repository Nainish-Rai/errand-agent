import { defineDynamic, defineInstructions } from "eve/instructions";

import { container } from "../../src/composition/container";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1_000;

// The model can't know the date, and "this week" needs one. ctx.now is the session's recorded
// time, so a replayed turn sees the same date it saw the first time. A pinned clock
// (ERRAND_CLOCK_START, set by the evals) wins, so a recorded run replays the same on any day.
export default defineDynamic((ctx) => {
  const now = container().isClockPinned ? container().clock.now() : ctx.now;
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const date = ist.toISOString().slice(0, 10);
  const weekday = ist.toLocaleDateString("en-IN", { weekday: "long", timeZone: "UTC" });
  return defineInstructions({ content: `Today is ${date} (${weekday}) in Bengaluru, time zone IST (UTC+05:30).` });
});
