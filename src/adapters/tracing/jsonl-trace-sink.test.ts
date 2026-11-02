import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TraceEvent, TraceSpan } from "../../core/ports/trace-sink";
import { getSessionTrace } from "../../core/use-cases/get-session-trace";
import { InvalidTraceIdError, JsonlTraceSink } from "./jsonl-trace-sink";
import { Sanitizer } from "./sanitize";

const FAKE_KEY = "sk-api-FAKEfakeFAKE0123456789abcdefABCDEF";
const SESSION = "wrun_test_session";

function toolSpan(overrides: Partial<TraceSpan>): TraceSpan {
  return {
    type: "span",
    traceId: SESSION,
    spanId: "tool:1",
    parentSpanId: "turn:0",
    sessionId: SESSION,
    kind: "tool",
    name: "execute_tool search_providers",
    status: "running",
    startTimeMs: 1_000,
    attributes: { "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": "search_providers" },
    ...overrides,
  };
}

describe("the JSONL trace sink", () => {
  let directory: string;
  let sink: JsonlTraceSink;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "errand-trace-"));
    sink = new JsonlTraceSink({ directory, sanitizer: new Sanitizer({ secrets: [FAKE_KEY] }) });
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("writes one sanitised line per record, so no phone, email or key reaches the file", async () => {
    await sink.record(
      toolSpan({
        attributes: {
          "gen_ai.tool.call.arguments": { note: "call +91 98765 43210 or mail a.b@example.com", apiKey: FAKE_KEY },
          "gen_ai.tool.call.result": `used ${FAKE_KEY}`,
        },
      }),
    );
    const file = await readFile(path.join(directory, `${SESSION}.jsonl`), "utf8");
    expect(file.trim().split("\n")).toHaveLength(1);
    expect(file).not.toContain(FAKE_KEY);
    expect(file).not.toContain("98765");
    expect(file).not.toContain("example.com");
    expect(JSON.parse(file)).toMatchObject({ schema: "errand.trace/1", type: "span", spanId: "tool:1" });
  });

  it("shows a running span, then the same span finished, as one span", async () => {
    await sink.record(toolSpan({}));
    let trace = await getSessionTrace(sink, SESSION);
    expect(trace.spans.map((span) => span.status)).toEqual(["running"]);

    await sink.record(toolSpan({ status: "ok", endTimeMs: 1_250, durationMs: 250 }));
    trace = await getSessionTrace(sink, SESSION);
    expect(trace.spans).toHaveLength(1);
    expect(trace.spans[0]).toMatchObject({ status: "ok", durationMs: 250 });
    expect(trace.totals).toMatchObject({ toolCalls: 1, durationMs: 250, errors: 0 });
  });

  it("never reopens a finished span when its start record lands after its end", async () => {
    await sink.record(toolSpan({ status: "error", endTimeMs: 1_100, durationMs: 100 }));
    await sink.record(toolSpan({}));
    const trace = await getSessionTrace(sink, SESSION);
    expect(trace.spans[0]?.status).toBe("error");
    expect(trace.totals.errors).toBe(1);
  });

  it("totals model tokens and cost across the trace", async () => {
    const model = (spanId: string, input: number, output: number, usd: number): TraceSpan => ({
      ...toolSpan({}),
      spanId,
      kind: "model",
      name: "chat MiniMax-M3",
      status: "ok",
      endTimeMs: 2_000,
      attributes: { "gen_ai.usage.input_tokens": input, "gen_ai.usage.output_tokens": output, "errand.cost.usd": usd },
    });
    await sink.record(model("model:1", 1_000, 20, 0.001));
    await sink.record(model("model:2", 2_000, 40, 0.002));
    const { totals } = await getSessionTrace(sink, SESSION);
    expect(totals).toMatchObject({ modelCalls: 2, inputTokens: 3_000, outputTokens: 60 });
    expect(totals.costUsd).toBeCloseTo(0.003, 10);
  });

  it("keeps the slot for state-transition and context events", async () => {
    const event: TraceEvent = {
      type: "event",
      traceId: SESSION,
      eventId: "state:1",
      sessionId: SESSION,
      kind: "state_transition",
      name: "errand.state_transition",
      timeMs: 1_500,
      attributes: { "errand.state.from": "clarifying", "errand.state.to": "searching" },
    };
    await sink.record(event);
    const trace = await getSessionTrace(sink, SESSION);
    expect(trace.events).toEqual([event]);
    expect(trace.spans).toEqual([]);
  });

  it("reads a trace that doesn't exist yet as empty, and skips a line cut short by a crash", async () => {
    expect(await sink.read(SESSION)).toEqual([]);
    await sink.record(toolSpan({}));
    await appendFile(path.join(directory, `${SESSION}.jsonl`), '{"schema":"errand.trace/1","type":"sp');
    expect(await sink.read(SESSION)).toHaveLength(1);
  });

  it("refuses an id that could leave the trace directory", async () => {
    await expect(sink.read("../etc/passwd")).rejects.toThrow(InvalidTraceIdError);
    await expect(sink.record(toolSpan({ traceId: "a/b" }))).rejects.toThrow(InvalidTraceIdError);
  });
});
