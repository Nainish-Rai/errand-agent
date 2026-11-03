import { describe, expect, it } from "vitest";

import type { Clock } from "../../core/ports/clock";
import { listOperatorReads } from "../../core/use-cases/list-operator-reads";
import { recordOperatorRead } from "../../core/use-cases/record-operator-read";
import { openDatabase } from "./database";
import { SqliteOperatorReadLog } from "./sqlite-operator-read-log";

function clockAt(...times: number[]): Clock {
  let next = 0;
  return { now: () => new Date(times[Math.min(next++, times.length - 1)] ?? 0) };
}

describe("the operator read audit", () => {
  it("records every read with its operator, session and time, and sums them per operator and kind", async () => {
    const reads = new SqliteOperatorReadLog(openDatabase(":memory:"));
    const clock = clockAt(1_000, 2_000, 3_000, 4_000);
    await recordOperatorRead({ reads, clock }, { operatorId: "ops-a", sessionId: "ses_1", kind: "trace" });
    await recordOperatorRead({ reads, clock }, { operatorId: "ops-a", sessionId: "ses_1", kind: "trace" });
    await recordOperatorRead({ reads, clock }, { operatorId: "ops-a", sessionId: "ses_1", kind: "context" });
    await recordOperatorRead({ reads, clock }, { operatorId: "ops-b", sessionId: "ses_2", kind: "trace" });
    expect(await listOperatorReads(reads, "ses_1")).toEqual([
      { operatorId: "ops-a", kind: "context", reads: 1, firstAtMs: 3_000, lastAtMs: 3_000 },
      { operatorId: "ops-a", kind: "trace", reads: 2, firstAtMs: 1_000, lastAtMs: 2_000 },
    ]);
    expect(await listOperatorReads(reads, "ses_2")).toEqual([{ operatorId: "ops-b", kind: "trace", reads: 1, firstAtMs: 4_000, lastAtMs: 4_000 }]);
    expect(await listOperatorReads(reads, "ses_never_read")).toEqual([]);
  });

  it("refuses a kind of read it doesn't know, in the database itself", () => {
    const db = openDatabase(":memory:");
    new SqliteOperatorReadLog(db);
    expect(() => db.prepare("INSERT INTO operator_reads (operator_id, session_id, kind, read_at_ms) VALUES ('o', 's', 'memory', 1)").run()).toThrow(/CHECK/);
  });
});
