import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { databasePath, migrate, openDatabase } from "./database";

const notes = { id: "0001_notes", sql: "CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL)" };
const tags = { id: "0002_tags", sql: "CREATE TABLE tags (id TEXT PRIMARY KEY)" };

describe("sqlite database", () => {
  it("applies each migration once, in id order", () => {
    const db = openDatabase(":memory:");
    expect(migrate(db, [tags, notes])).toEqual(["0001_notes", "0002_tags"]);
    expect(migrate(db, [tags, notes])).toEqual([]);
  });

  it("keeps rows across a reopen, so a restart loses nothing", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "errand-db-")), "errand.db");
    const first = openDatabase(file);
    migrate(first, [notes]);
    first.prepare("INSERT INTO notes (id, body) VALUES (?, ?)").run("n1", "kept");
    first.close();
    const second = openDatabase(file);
    expect(migrate(second, [notes])).toEqual([]);
    expect(second.prepare("SELECT body FROM notes WHERE id = ?").get("n1")).toEqual({ body: "kept" });
    second.close();
  });

  it("rolls back a failing migration and records nothing", () => {
    const db = openDatabase(":memory:");
    const broken = { id: "0003_broken", sql: "CREATE TABLE ok (id TEXT); CREATE TABLE ok (id TEXT)" };
    expect(() => migrate(db, [broken])).toThrow();
    expect(db.prepare("SELECT count(*) AS n FROM schema_migrations").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'ok'").get()).toEqual({ n: 0 });
  });

  it("refuses duplicate migration ids", () => {
    expect(() => migrate(openDatabase(":memory:"), [notes, notes])).toThrow(/duplicate/);
  });

  it("puts the database under ERRAND_DATA_DIR, else data/ in the working directory", () => {
    expect(databasePath({ ERRAND_DATA_DIR: "/tmp/run-7" }, "/repo")).toBe("/tmp/run-7/errand.db");
    expect(databasePath({}, "/repo")).toBe("/repo/data/errand.db");
  });
});
