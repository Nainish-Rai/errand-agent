import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  attemptStarted,
  changeConfirmed,
  confirmedAs,
  type BookingIntent,
  type CancellationIntent,
  type RescheduleIntent,
} from "../../core/booking/action-intent";
import { migrate, openDatabase } from "./database";
import {
  ACTION_LEDGER_MIGRATIONS,
  SqliteActionLedger,
} from "./sqlite-action-ledger";

function intent(grantId: string, sessionId = "ses_1"): BookingIntent {
  return {
    idempotencyKey: `book:${grantId}`,
    action: "book",
    proposalId: `prp_${grantId}`,
    grantId,
    sessionId,
    userId: "dev-user",
    holdId: "hold_0001",
    holdExpiresAt: "2026-11-04T03:40:00.000Z",
    state: "pending",
    attempts: 0,
    version: 1,
    createdAtMs: 1_000,
    updatedAtMs: 1_000,
  };
}

function changeIntent(action: "cancel", grantId: string): CancellationIntent;
function changeIntent(action: "reschedule", grantId: string): RescheduleIntent;
function changeIntent(
  action: "cancel" | "reschedule",
  grantId: string,
): CancellationIntent | RescheduleIntent {
  const { holdId: _hold, holdExpiresAt: _expiry, ...common } = intent(grantId);
  const base = {
    ...common,
    idempotencyKey: `${action}:${grantId}`,
    targetBookingId: "bkg_seed_3",
  };
  return action === "cancel"
    ? { ...base, action }
    : {
        ...base,
        action,
        newSlot: {
          start: "2026-11-07T14:00:00+05:30",
          end: "2026-11-07T15:00:00+05:30",
        },
      };
}

describe("the SQLite action ledger", () => {
  it("records an intent once per idempotency key, however often it is written", async () => {
    const ledger = new SqliteActionLedger(openDatabase(":memory:"));
    const first = await ledger.record(intent("grt_1"));
    const again = await ledger.record({
      ...intent("grt_1"),
      attempts: 2,
      createdAtMs: 9_999,
    });
    expect(again).toEqual(first);
    expect(await ledger.list({})).toHaveLength(1);
  });

  it("saves a change only over the version it was made from, so two writers can't both win", async () => {
    const ledger = new SqliteActionLedger(openDatabase(":memory:"));
    const recorded = await ledger.record(intent("grt_1"));
    const mine = attemptStarted(recorded, 2_000);
    const theirs = attemptStarted(recorded, 2_001);
    expect(await ledger.advance(mine)).toBe(true);
    expect(await ledger.advance(theirs)).toBe(false);
    expect(await ledger.find(recorded.idempotencyKey)).toEqual(mine);
  });

  it("lists only pending and unknown intents as unresolved, per session", async () => {
    const ledger = new SqliteActionLedger(openDatabase(":memory:"));
    const one = await ledger.record(intent("grt_1"));
    await ledger.record(intent("grt_2", "ses_2"));
    const attempted = attemptStarted(one, 2_000);
    expect(await ledger.advance(attempted)).toBe(true);
    expect(
      await ledger.advance(confirmedAs(attempted, "bkg_1", "execution", 2_100)),
    ).toBe(true);
    expect((await ledger.unresolved()).map((stored) => stored.grantId)).toEqual(
      ["grt_2"],
    );
    expect(await ledger.unresolved({ sessionId: "ses_1" })).toEqual([]);
    expect((await ledger.list({ sessionId: "ses_1" }))[0]).toMatchObject({
      state: "confirmed",
      bookingId: "bkg_1",
      attempts: 1,
    });
  });

  it("survives a restart: a new process on the same file finds the unresolved intent", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "errand-ledger-"));
    const file = path.join(dir, "errand.db");
    try {
      const before = new SqliteActionLedger(openDatabase(file));
      await before.advance(
        attemptStarted(await before.record(intent("grt_1")), 2_000),
      );
      const after = new SqliteActionLedger(openDatabase(file));
      expect(await after.unresolved()).toMatchObject([
        {
          grantId: "grt_1",
          state: "pending",
          attempts: 1,
          lastAttemptAtMs: 2_000,
        },
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps a cancellation and a reschedule with the booking they change, through to confirmed", async () => {
    const ledger = new SqliteActionLedger(openDatabase(":memory:"));
    const cancel = await ledger.record(changeIntent("cancel", "grt_c"));
    const move = await ledger.record(changeIntent("reschedule", "grt_r"));
    const attempted = attemptStarted(cancel, 2_000);
    expect(await ledger.advance(attempted)).toBe(true);
    expect(
      await ledger.advance(changeConfirmed(attempted, "execution", 2_100)),
    ).toBe(true);
    expect(await ledger.find("cancel:grt_c")).toEqual(
      changeConfirmed(attempted, "execution", 2_100),
    );
    expect(await ledger.find("reschedule:grt_r")).toEqual(move);
    expect(
      (await ledger.unresolved()).map((stored) => stored.idempotencyKey),
    ).toEqual(["reschedule:grt_r"]);
  });

  it("refuses a change intent without the booking it changes", () => {
    const db = openDatabase(":memory:");
    new SqliteActionLedger(db);
    const insert = () =>
      db.exec(`INSERT INTO action_intents (idempotency_key, action, proposal_id, grant_id, session_id, user_id, state, attempts,
        version, created_at_ms, updated_at_ms, seq) VALUES ('cancel:g', 'cancel', 'p', 'g', 's', 'u', 'pending', 0, 1, 1, 1, 1)`);
    expect(insert).toThrow(/CHECK constraint failed/);
  });

  it("migration 1000 keeps every booking intent written before it", async () => {
    const db = openDatabase(":memory:");
    migrate(
      db,
      ACTION_LEDGER_MIGRATIONS.filter((migration) => migration.id < "1000"),
    );
    db.exec(`INSERT INTO action_intents (idempotency_key, action, proposal_id, grant_id, session_id, user_id, hold_id,
      hold_expires_at, state, attempts, version, created_at_ms, updated_at_ms, booking_id, resolved_at_ms, resolved_by, seq)
      VALUES ('book:grt_old', 'book', 'prp_old', 'grt_old', 'ses_1', 'dev-user', 'hold_0001', '2026-11-04T03:40:00.000Z',
      'confirmed', 1, 3, 1000, 2100, 'bkg_1', 2100, 'execution', 1)`);
    const ledger = new SqliteActionLedger(db);
    expect(await ledger.find("book:grt_old")).toMatchObject({
      action: "book",
      holdId: "hold_0001",
      state: "confirmed",
      bookingId: "bkg_1",
      version: 3,
    });
    expect(
      (await ledger.record(changeIntent("cancel", "grt_new"))).action,
    ).toBe("cancel");
    expect(await ledger.list({})).toHaveLength(2);
  });
});
