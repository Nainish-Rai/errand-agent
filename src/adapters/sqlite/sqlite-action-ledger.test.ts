import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { attemptStarted, confirmedAs, type ActionIntent } from "../../core/booking/action-intent";
import { openDatabase } from "./database";
import { SqliteActionLedger } from "./sqlite-action-ledger";

function intent(grantId: string, sessionId = "ses_1"): ActionIntent {
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

describe("the SQLite action ledger", () => {
  it("records an intent once per idempotency key, however often it is written", async () => {
    const ledger = new SqliteActionLedger(openDatabase(":memory:"));
    const first = await ledger.record(intent("grt_1"));
    const again = await ledger.record({ ...intent("grt_1"), attempts: 2, createdAtMs: 9_999 });
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
    expect(await ledger.advance(confirmedAs(attempted, "bkg_1", "execution", 2_100))).toBe(true);
    expect((await ledger.unresolved()).map((stored) => stored.grantId)).toEqual(["grt_2"]);
    expect(await ledger.unresolved({ sessionId: "ses_1" })).toEqual([]);
    expect((await ledger.list({ sessionId: "ses_1" }))[0]).toMatchObject({ state: "confirmed", bookingId: "bkg_1", attempts: 1 });
  });

  it("survives a restart: a new process on the same file finds the unresolved intent", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "errand-ledger-"));
    const file = path.join(dir, "errand.db");
    try {
      const before = new SqliteActionLedger(openDatabase(file));
      await before.advance(attemptStarted(await before.record(intent("grt_1")), 2_000));
      const after = new SqliteActionLedger(openDatabase(file));
      expect(await after.unresolved()).toMatchObject([{ grantId: "grt_1", state: "pending", attempts: 1, lastAttemptAtMs: 2_000 }]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
