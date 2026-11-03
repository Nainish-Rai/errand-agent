import type { Clock } from "../ports/clock";
import type { ProviderWorld } from "../ports/provider-world";

// GetSpend: what the person spent on home services per month, and how many bookings, from the
// world's bookings (list_bookings). Cancelled bookings cost nothing and don't count. It feeds the
// spend chart, so the chart's numbers are the world's, whatever the model wrote.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1_000;

export interface MonthSpend {
  /** YYYY-MM in IST. */
  readonly month: string;
  readonly spendInr: number;
  readonly bookings: number;
}

function monthsBack(nowMs: number, count: number): string[] {
  const ist = new Date(nowMs + IST_OFFSET_MS);
  return Array.from({ length: count }, (_, index) => {
    const month = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - (count - 1 - index), 1));
    return month.toISOString().slice(0, 7);
  });
}

export async function getSpend(
  deps: { readonly world: ProviderWorld; readonly clock: Clock },
  request: { readonly userId: string; readonly months: number },
): Promise<readonly MonthSpend[]> {
  const bookings = (await deps.world.listBookings(request.userId)).filter((booking) => booking.status !== "cancelled");
  return monthsBack(deps.clock.now().getTime(), request.months).map((month) => {
    const inMonth = bookings.filter((booking) => booking.slot.start.slice(0, 7) === month);
    return { month, spendInr: inMonth.reduce((sum, booking) => sum + booking.priceInr, 0), bookings: inMonth.length };
  });
}
