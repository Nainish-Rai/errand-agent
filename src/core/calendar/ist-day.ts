// Days as the person lives them: every errand is in Bengaluru, so a day is an IST calendar day
// (UTC+05:30, no daylight saving). Dates are YYYY-MM-DD strings, like the errand's time window.

const DAY_MS = 24 * 60 * 60 * 1_000;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1_000;

/** The IST date of an instant. */
export function istDayOf(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The date `days` days after `date` (before it, for a negative count). */
export function dayAfter(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** `count` consecutive dates starting at `from`. */
export function daysFrom(from: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => dayAfter(from, index));
}
