import { defineDynamic, defineInstructions } from "eve/instructions";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1_000;

// The model can't know the date, and "this week" needs one. ctx.now is the session's recorded
// time, so a replayed turn sees the same date it saw the first time.
export default defineDynamic((ctx) => {
  const ist = new Date(ctx.now.getTime() + IST_OFFSET_MS);
  const date = ist.toISOString().slice(0, 10);
  const weekday = ist.toLocaleDateString("en-IN", { weekday: "long", timeZone: "UTC" });
  return defineInstructions({ content: `Today is ${date} (${weekday}) in Bengaluru, time zone IST (UTC+05:30).` });
});
