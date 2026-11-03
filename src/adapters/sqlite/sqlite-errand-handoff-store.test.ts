import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { Errand } from "../../core/errand/errand";
import type { RecordedSearch, SessionToolCalls } from "../../core/ports/session-tool-calls";
import type { TraceEvent, TraceRecord, TraceSink } from "../../core/ports/trace-sink";
import { dismissNewErrand } from "../../core/use-cases/dismiss-new-errand";
import { listErrandHandoffs } from "../../core/use-cases/list-errand-handoffs";
import { startNewErrand, type NewErrandSearch } from "../../core/use-cases/start-new-errand";
import { InMemoryErrandStore } from "../memory/in-memory-errand-store";
import { worldCatalog } from "../world/world-catalog";
import { openDatabase } from "./database";
import { SqliteErrandHandoffStore } from "./sqlite-errand-handoff-store";

// New errand cards (ticket 24) through the use cases and the SQLite store: a booked chat's job moves
// to a new chat that starts from the refused search, each card settles once, and the link between
// the two chats is kept in the database.

class Sink implements TraceSink {
  readonly records: TraceRecord[] = [];
  async record(record: TraceRecord) {
    this.records.push(record);
  }
  async read() {
    return this.records;
  }
  events(): TraceEvent[] {
    return this.records.filter((record): record is TraceEvent => record.type === "event");
  }
}

/** The chat session's own record of its tool calls: only searches recorded here back a card. */
class RecordedCalls implements SessionToolCalls {
  private readonly calls = new Map<string, RecordedSearch>();
  record(sessionId: string, toolCallId: string, search: NewErrandSearch, outcome = "not_editable") {
    this.calls.set(`${sessionId}/${toolCallId}`, { ...search, outcome });
  }
  async searchCall(sessionId: string, toolCallId: string) {
    return this.calls.get(`${sessionId}/${toolCallId}`);
  }
}

const NOW = Date.parse("2026-11-04T09:00:00+05:30");
const AC_IN_HSR: NewErrandSearch = { service: "ac_servicing", area: "hsr", dates: { from: "2026-11-04", to: "2026-11-10" } };

function bookedErrand(sessionId: string): Errand {
  return {
    errandId: `errand_${sessionId}`,
    sessionId,
    details: { service: "plumber", area: "Indiranagar", timeWindow: { dates: { from: "2026-11-04", to: "2026-11-10" } }, preferences: [] },
    state: "done",
    transitions: [],
  };
}

async function setup(file = ":memory:", oldState: Errand["state"] = "done") {
  const errands = new InMemoryErrandStore();
  await errands.change("old", async () => ({ errand: { ...bookedErrand("old"), state: oldState }, result: undefined }));
  const handoffs = new SqliteErrandHandoffStore(openDatabase(file));
  const toolCalls = new RecordedCalls();
  toolCalls.record("old", "call_ac", AC_IN_HSR);
  toolCalls.record("old", "call_second", AC_IN_HSR);
  const deps = { errands, handoffs, toolCalls, catalog: worldCatalog, traceSink: new Sink(), clock: { now: () => new Date(NOW) } };
  const move = (toSessionId: string, search: NewErrandSearch = AC_IN_HSR, toolCallId = "call_ac") =>
    startNewErrand(deps, { fromSessionId: "old", toolCallId, place: { traceId: toSessionId, sessionId: toSessionId }, search });
  return { deps, errands, handoffs, toolCalls, move };
}

describe("a different job in a booked chat moves to a new chat", () => {
  it("starts the new chat's errand from the refused search, links both chats and leaves the booking alone", async () => {
    const { deps, errands, handoffs, move } = await setup();
    const outcome = await move("new");

    expect(outcome.kind).toBe("moved");
    expect((await errands.find("new"))?.details).toEqual({
      service: "ac_servicing",
      area: "HSR Layout",
      timeWindow: { dates: { from: "2026-11-04", to: "2026-11-10" } },
      preferences: [],
    });
    expect((await errands.find("new"))?.state).toBe("gathering");
    expect(await errands.find("old")).toEqual(bookedErrand("old"));
    expect(deps.traceSink.events().filter((event) => event.kind === "errand_drafted").map((event) => [event.sessionId, event.name])).toEqual([
      ["new", "new errand card → errand: service, area, timeWindow"],
    ]);

    const moved = { kind: "moved", fromSessionId: "old", toolCallId: "call_ac", toSessionId: "new", settledAtMs: NOW, origin: { service: "plumber", area: "Indiranagar" } };
    expect(await listErrandHandoffs(handoffs, "old")).toEqual({ settled: [moved] });
    expect(await listErrandHandoffs(handoffs, "new")).toEqual({ settled: [], startedFrom: moved });
  });

  it("a second tap on the card answers with the first chat and drafts nothing in the second", async () => {
    const { errands, move } = await setup();
    await move("new");
    const again = await move("another");
    expect(again.kind === "already_settled" && again.handoff.kind === "moved" && again.handoff.toSessionId).toBe("new");
    expect(await errands.find("another")).toBeUndefined();
  });

  it("Not now settles the card for good, and a moved card stays moved", async () => {
    const { deps, errands, move } = await setup();
    expect((await dismissNewErrand(deps, { fromSessionId: "old", toolCallId: "call_ac" })).kind).toBe("dismissed");
    const after = await move("new");
    expect(after.kind === "already_settled" && after.handoff.kind).toBe("dismissed");
    expect(await errands.find("new")).toBeUndefined();

    await move("other", AC_IN_HSR, "call_second");
    const late = await dismissNewErrand(deps, { fromSessionId: "old", toolCallId: "call_second" });
    expect(late.kind === "already_settled" && late.handoff.kind).toBe("moved");
  });

  it("refuses while the chat's own errand can still change, and records nothing", async () => {
    const { handoffs, errands, move } = await setup(":memory:", "choosing");
    expect(await move("new")).toEqual({ kind: "still_editable" });
    expect(await handoffs.settledIn("old")).toEqual([]);
    expect(await errands.find("new")).toBeUndefined();
  });

  it("only a fresh chat takes the job: one with an errand, or the chat itself, is refused", async () => {
    const { errands, move } = await setup();
    await errands.change("busy", async () => ({ errand: bookedErrand("busy"), result: undefined }));
    expect(await move("busy")).toEqual({ kind: "errand_exists" });
    expect(await move("old")).toEqual({ kind: "same_session" });
  });

  it("leaves a search field the catalog doesn't know for the new chat to ask about, and still moves", async () => {
    const { errands, toolCalls, move } = await setup();
    const odd: NewErrandSearch = { service: "ac servicing", area: "Atlantis", dates: { from: "2026-11-10", to: "2026-11-04" } };
    toolCalls.record("old", "call_odd", odd);
    const outcome = await move("new", odd, "call_odd");
    expect(outcome.kind).toBe("moved");
    expect((await errands.find("new"))?.details).toEqual({ service: "ac_servicing", preferences: [] });
  });

  it("refuses a card the chat's own record doesn't back: a forged id, edited details, or a search that wasn't refused", async () => {
    const { deps, errands, handoffs, toolCalls, move } = await setup();
    toolCalls.record("old", "call_found", AC_IN_HSR, "found");
    toolCalls.record("other", "call_elsewhere", AC_IN_HSR);

    expect(await move("new", AC_IN_HSR, "call_forged")).toEqual({ kind: "unknown_card" });
    expect(await move("new", AC_IN_HSR, "call_elsewhere")).toEqual({ kind: "unknown_card" });
    expect(await move("new", { ...AC_IN_HSR, area: "koramangala" })).toEqual({ kind: "search_mismatch" });
    expect(await move("new", { ...AC_IN_HSR, service: "pest_control" })).toEqual({ kind: "search_mismatch" });
    expect(await move("new", { ...AC_IN_HSR, dates: { from: "2026-11-04", to: "2026-11-30" } })).toEqual({ kind: "search_mismatch" });
    expect(await move("new", AC_IN_HSR, "call_found")).toEqual({ kind: "not_refused" });
    expect(await dismissNewErrand(deps, { fromSessionId: "old", toolCallId: "call_forged" })).toEqual({ kind: "unknown_card" });
    expect(await dismissNewErrand(deps, { fromSessionId: "old", toolCallId: "call_found" })).toEqual({ kind: "not_refused" });

    expect(await errands.find("new")).toBeUndefined();
    expect(await handoffs.settledIn("old")).toEqual([]);
    expect(deps.traceSink.events()).toEqual([]);
  });

  it("keeps the link between the chats across a restart", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "handoffs-")), "errand.db");
    const { move } = await setup(file);
    await move("new");
    const reopened = new SqliteErrandHandoffStore(openDatabase(file));
    expect((await reopened.startedIn("new"))?.fromSessionId).toBe("old");
    expect((await reopened.settledIn("old")).map((handoff) => handoff.kind)).toEqual(["moved"]);
  });
});
