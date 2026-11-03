import { describe, expect, it } from "vitest";

import { checkSessionOwnership } from "../../core/use-cases/check-session-ownership";
import { claimSession } from "../../core/use-cases/claim-session";
import { openDatabase } from "./database";
import { SqliteSessionOwnerStore } from "./sqlite-session-owner-store";

describe("session ownership", () => {
  it("gives a session to the first caller who reaches it, and to nobody else after", async () => {
    const owners = new SqliteSessionOwnerStore(openDatabase(":memory:"));
    expect(await claimSession(owners, { sessionId: "ses_a", userId: "user-a", atMs: 1_000 })).toEqual({ kind: "claimed" });
    expect(await claimSession(owners, { sessionId: "ses_a", userId: "user-a", atMs: 2_000 })).toEqual({ kind: "owned" });
    expect(await claimSession(owners, { sessionId: "ses_a", userId: "user-b", atMs: 3_000 })).toEqual({ kind: "not_found" });
    expect(await owners.list()).toEqual([{ sessionId: "ses_a", ownerId: "user-a", claimedAtMs: 1_000 }]);
  });

  it("answers another person's session exactly as a session that doesn't exist", async () => {
    const owners = new SqliteSessionOwnerStore(openDatabase(":memory:"));
    await claimSession(owners, { sessionId: "ses_a", userId: "user-a", atMs: 1_000 });
    expect(await checkSessionOwnership(owners, { sessionId: "ses_a", userId: "user-a" })).toEqual({ kind: "owned" });
    expect(await checkSessionOwnership(owners, { sessionId: "ses_a", userId: "user-b" })).toEqual({ kind: "not_found" });
    expect(await checkSessionOwnership(owners, { sessionId: "ses_unknown", userId: "user-b" })).toEqual({ kind: "not_found" });
  });

  it("never lets a read claim a session: an unclaimed session belongs to nobody", async () => {
    const owners = new SqliteSessionOwnerStore(openDatabase(":memory:"));
    expect(await checkSessionOwnership(owners, { sessionId: "ses_new", userId: "user-a" })).toEqual({ kind: "not_found" });
    expect(await owners.ownerOf("ses_new")).toBeUndefined();
  });

  it("keeps the first owner when a second claim races in on the same database", async () => {
    const db = openDatabase(":memory:");
    const first = new SqliteSessionOwnerStore(db);
    const second = new SqliteSessionOwnerStore(db);
    expect(await first.claim({ sessionId: "ses_a", ownerId: "user-a", claimedAtMs: 1 })).toBe("user-a");
    expect(await second.claim({ sessionId: "ses_a", ownerId: "user-b", claimedAtMs: 2 })).toBe("user-a");
  });

  it("lists sessions newest first", async () => {
    const owners = new SqliteSessionOwnerStore(openDatabase(":memory:"));
    await claimSession(owners, { sessionId: "ses_old", userId: "user-a", atMs: 1_000 });
    await claimSession(owners, { sessionId: "ses_new", userId: "user-b", atMs: 2_000 });
    expect((await owners.list()).map((session) => session.sessionId)).toEqual(["ses_new", "ses_old"]);
  });
});
