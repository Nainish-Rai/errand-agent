import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { MemoryFact } from "../../core/memory/memory-fact";
import { closed } from "../../core/memory/memory-fact";
import { openDatabase } from "./database";
import { SqliteMemoryStore } from "./sqlite-memory-store";

const fact: MemoryFact = {
  id: "fact_1",
  ownerId: "me",
  key: "area",
  value: "Koramangala",
  source: "explicit",
  status: "active",
  evidence: { kind: "user_message", sessionId: "s1", quote: "Koramangala", position: "latest" },
  validFromMs: 1_000,
};

describe("sqlite memory store", () => {
  it("keeps facts and tombstones across a restart, per person", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "errand-memory-")), "errand.db");
    const first = new SqliteMemoryStore(openDatabase(file));
    await first.change("me", () => ({
      save: [fact],
      tombstones: [{ ownerId: "me", key: "budget", forgottenAtMs: 2_000, evidence: { kind: "user_action", action: "forget" } }],
      result: undefined,
    }));
    const second = new SqliteMemoryStore(openDatabase(file));
    expect(await second.read("me")).toEqual({
      facts: [fact],
      tombstones: [{ ownerId: "me", key: "budget", forgottenAtMs: 2_000, evidence: { kind: "user_action", action: "forget" } }],
    });
    expect(await second.read("someone-else")).toEqual({ facts: [], tombstones: [] });
  });

  it("closes a fact's window in place but refuses to change what it says", async () => {
    const db = openDatabase(":memory:");
    const store = new SqliteMemoryStore(db);
    await store.change("me", () => ({ save: [fact], tombstones: [], result: undefined }));
    await store.change("me", () => ({ save: [closed(fact, "superseded", 5_000, "fact_2")], tombstones: [], result: undefined }));
    expect((await store.read("me")).facts).toEqual([{ ...fact, status: "superseded", validToMs: 5_000, supersededBy: "fact_2" }]);
    expect(() => db.prepare("UPDATE memory_facts SET value = 'HSR Layout' WHERE id = 'fact_1'").run()).toThrow(/never edited in place/);
  });

  it("rolls back every write of a change that throws", async () => {
    const store = new SqliteMemoryStore(openDatabase(":memory:"));
    await expect(
      store.change("me", () => ({ save: [fact, { ...fact, ownerId: "someone-else", id: "fact_2" }], tombstones: [], result: undefined })),
    ).rejects.toThrow();
    expect((await store.read("me")).facts).toEqual([]);
  });
});
