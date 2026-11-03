import type { ErrandAtWorkView, ErrandState } from "@errand/contracts";

// The home screen's words for errands, services, steps and times. Times are always IST: every
// errand is in Bengaluru, whatever the browser's time zone.

type Service = NonNullable<ErrandAtWorkView["service"]>;

const SERVICES: Readonly<Record<Service, string>> = {
  plumber: "Plumber",
  electrician: "Electrician",
  ac_servicing: "AC servicing",
  carpenter: "Carpenter",
  cleaner: "Cleaning",
};

export function serviceLabel(service: Service | null): string {
  return service === null ? "New errand" : SERVICES[service];
}

/** What the errand is doing now, in the person's words. */
const STEPS: Readonly<Record<ErrandState, string>> = {
  gathering: "getting the details",
  searching: "searching providers",
  choosing: "options ready · pick one",
  holding: "holding your slot",
  awaiting_approval: "approval card waiting for you",
  executing: "booking with the provider",
  verifying: "checking with the provider",
  done: "booked",
  failed: "stopped",
  cancelled: "cancelled",
};

export function stepLabel(state: ErrandState): string {
  return STEPS[state];
}

const dayFormat = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const timeFormat = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
const shortDayFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** "Thu 6 Nov · 09:00" */
export function slotLabel(start: string): string {
  const at = new Date(start);
  return `${dayFormat.format(at).replace(",", "")} · ${timeFormat.format(at)}`;
}

/** "6 Nov" for a YYYY-MM-DD date. */
export function dateLabel(date: string): string {
  return shortDayFormat.format(new Date(`${date}T00:00:00Z`));
}

function pad(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** "Plumber · Koramangala" */
export function errandTitle(errand: Pick<ErrandAtWorkView, "service" | "area">): string {
  return [serviceLabel(errand.service), errand.area].filter((part) => part !== null).join(" · ");
}

/** "4–10 Nov · 08:00–12:00 · ≤ ₹1,500", or what is still open. */
export function errandDetails(errand: ErrandAtWorkView): string {
  const window = errand.timeWindow;
  const when =
    window === null
      ? "when: not set"
      : `${dateLabel(window.from)}–${dateLabel(window.to)}${window.earliestHour === null ? "" : ` · ${pad(window.earliestHour)}–${pad(window.latestHour ?? 24)}`}`;
  const budget = errand.budgetInr === null ? [] : [`≤ ₹${errand.budgetInr.toLocaleString("en-IN")}`];
  return [when, ...budget].join(" · ");
}

/** "0:42", "12m", "3h", "2d": how long ago, compact and mono. */
export function sinceLabel(at: string, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - Date.parse(at)) / 1_000));
  if (seconds < 60 * 10) return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  if (seconds < 60 * 60) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 60 * 60 * 24) return `${Math.floor(seconds / 3_600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

export function hourLabel(hour: number): string {
  return pad(hour);
}
