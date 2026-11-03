import { describe, expect, it } from "vitest";

import type { CancelledVisit } from "../../core/provider-events/provider-cancellation";
import { openDatabase } from "./database";
import { SqliteProviderEventLog } from "./sqlite-provider-event-log";

const VISIT: CancelledVisit = {
  bookingId: "bkg_1",
  providerId: "prv_1",
  providerName: "Ravi Aircon Experts",
  service: "ac_servicing",
  slot: { start: "2026-11-09T11:00:00+05:30", end: "2026-11-09T12:00:00+05:30" },
  priceInr: 999,
};

function event(eventId: string, bookingId = "bkg_1") {
  return { eventId, bookingId, userId: "dev-user", atMs: 1_000 };
}

describe("the SQLite provider event log", () => {
  it("records an event once per id: a redelivery counts a delivery and keeps the first record", async () => {
    const log = new SqliteProviderEventLog(openDatabase(":memory:"));
    const first = await log.receive(event("evt_1"));
    const again = await log.receive({ ...event("evt_1"), atMs: 9_999 });
    expect(first).toMatchObject({ first: true, record: { decision: "pending", deliveries: 1, receivedAtMs: 1_000 } });
    expect(again).toMatchObject({ first: false, record: { decision: "pending", deliveries: 2, receivedAtMs: 1_000 } });
  });

  it("lets only one event per booking hold its notice, in the database itself", async () => {
    const log = new SqliteProviderEventLog(openDatabase(":memory:"));
    await log.receive(event("evt_1"));
    await log.receive(event("evt_2"));
    expect(await log.claimNotice("evt_1", { sessionId: "ses_1", visit: VISIT, atMs: 2_000 })).toBe(true);
    expect(await log.claimNotice("evt_2", { sessionId: "ses_2", visit: VISIT, atMs: 2_000 })).toBe(false);
    expect(await log.claimNotice("evt_1", { sessionId: "ses_1", visit: VISIT, atMs: 3_000 })).toBe(true);
    expect(await log.isBookingNotified("bkg_1", "evt_2")).toBe(true);
    expect(await log.isBookingNotified("bkg_1", "evt_1")).toBe(false);
  });

  it("serves notified events as the person's provider alerts, and nothing it skipped", async () => {
    const log = new SqliteProviderEventLog(openDatabase(":memory:"));
    await log.receive(event("evt_1"));
    await log.claimNotice("evt_1", { sessionId: "ses_1", visit: VISIT, atMs: 2_000 });
    await log.markNotified("evt_1", 2_500);
    await log.receive(event("evt_old", "bkg_past"));
    await log.skip("evt_old", "past_booking");
    expect(await log.listAlerts("dev-user")).toEqual([
      {
        kind: "provider_cancelled",
        alertId: "alert_evt_1",
        bookingId: "bkg_1",
        providerName: "Ravi Aircon Experts",
        service: "ac_servicing",
        slot: VISIT.slot,
        raisedAtMs: 2_000,
        sessionId: "ses_1",
      },
    ]);
    expect(await log.findEvent("evt_old")).toMatchObject({ decision: "skipped", skipReason: "past_booking" });
    expect(await log.listAlerts("someone-else")).toEqual([]);
  });
});
