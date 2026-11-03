import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { ApiClient, ChatClient, askFormMessage, chooseMessage, mintAccessToken, type ChatTurn, type EveMessage } from "@errand/client";
import {
  CARD_FOLLOW_UPS,
  type ActionIntentView,
  type GetSessionTraceResponse,
  type ModelScriptTurn,
  type ModelStep,
  type SearchProvidersInput,
} from "@errand/contracts";

import { presentSessionContext } from "../../agent/lib/context-presenter";
import { presentSessionTrace } from "../../agent/lib/trace-presenter";
import type { TraceRecord, TraceSink } from "../../src/core/ports/trace-sink";
import { getSessionContext } from "../../src/core/use-cases/get-session-context";
import { getSessionTrace } from "../../src/core/use-cases/get-session-trace";
import { DEMO_CLOCK_START, DEMO_SCRIPT, DEMO_WORLD, type DemoBeat, type DemoSessionScript } from "./demo-script";

// Records the hosted demo's fixture (apps/web/features/demo/recording.json) from the real system: a
// backend of its own (eve, the seeded mock world, core, SQLite) on the evals' pinned clock with the
// scripted model, driven through packages/client like any other client. Every message, tool output
// and API answer the demo replays is what the real code returned; only the model's turns are scripted,
// as in the offline evals. The operator view gets this run's own trace and the committed real trace
// (docs/traces/timeout-after-success.jsonl), read through the same core use case and presenter the
// backend serves /trace with.
//
//   pnpm demo:record
//
// Needs no key and no network. It starts and stops only its own backend (by its process group id).

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUTPUT = path.join(ROOT, "apps/web/features/demo/recording.json");
const OPS_OUTPUT = path.join(ROOT, "apps/web/features/demo/ops-recording.json");
const COMMITTED_TRACE = path.join(ROOT, "docs/traces/timeout-after-success.jsonl");
const OPERATOR_ID = "demo-operator";
const PASSED_THROUGH = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TZ"];

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Backend {
  readonly url: string;
  readonly secret: string;
  stop(): Promise<void>;
}

async function startBackend(): Promise<Backend> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "errand-demo-record-"));
  const port = await freePort();
  const secret = randomBytes(32).toString("hex");
  const environment: NodeJS.ProcessEnv = {};
  for (const name of PASSED_THROUGH) if (process.env[name] !== undefined) environment[name] = process.env[name];
  Object.assign(environment, {
    EVE_DEV_STATE_DIR: path.join(home, "state"),
    ERRAND_DATA_DIR: path.join(home, "data"),
    ERRAND_TRACE_DIR: path.join(home, "traces"),
    EVE_TELEMETRY_DISABLED: "1",
    ERRAND_MODELS: "main=scripted,review_reader=scripted,user_simulator=scripted",
    ERRAND_CLOCK_START: DEMO_CLOCK_START,
    ERRAND_AUTH_SECRET: secret,
    ERRAND_OPERATOR_IDS: OPERATOR_ID,
  });
  const log = path.join(home, "backend.log");
  const out = fs.openSync(log, "a");
  const child = spawn(path.join(ROOT, "node_modules/.bin/eve"), ["dev", "--no-ui", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: ROOT,
    env: environment,
    // Its own process group, so stopping it reaches eve's workers and nothing else.
    detached: true,
    stdio: ["ignore", out, out],
  });
  fs.closeSync(out);
  const pid = child.pid;
  if (pid === undefined) throw new Error("The backend did not start.");
  const url = `http://127.0.0.1:${port}`;
  const stop = async () => {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      return;
    }
    for (let waited = 0; waited < 5_000 && child.exitCode === null && child.signalCode === null; waited += 100) await sleep(100);
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  };
  const deadline = Date.now() + 120_000;
  for (;;) {
    const healthy = await fetch(`${url}/eve/v1/health`, { signal: AbortSignal.timeout(2_000) }).then(
      (response) => response.ok,
      () => false,
    );
    if (healthy) break;
    if (child.exitCode !== null || Date.now() > deadline) {
      await stop();
      throw new Error(`The backend didn't start; see ${log}`);
    }
    await sleep(250);
  }
  console.error(`backend ${pid} on ${url} (log ${log})`);
  return { url, secret, stop };
}

/** The committed trace through the backend's own read path: core's use cases, then the presenters. */
async function committedTrace() {
  const records = fs
    .readFileSync(COMMITTED_TRACE, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const { schema: _schema, ...record } = JSON.parse(line) as TraceRecord & { schema: string };
      return record as TraceRecord;
    });
  const sessionId = records[0]?.traceId ?? "unknown";
  const sink: TraceSink = { record: async () => undefined, read: async () => records };
  const trace = await getSessionTrace(sink, sessionId);
  const ends = trace.spans.map((span) => span.endTimeMs ?? span.startTimeMs);
  return {
    sessionId,
    startedAt: new Date(Math.min(...trace.spans.map((span) => span.startTimeMs))).toISOString(),
    trace: presentSessionTrace(trace, Math.max(...ends)),
    context: presentSessionContext(await getSessionContext(sink, sessionId)),
    transcript: transcriptFromTrace(sessionId, records),
  };
}

type ModelMessage = { readonly role: string; readonly content?: unknown; readonly parts?: readonly { type: string; content?: string; name?: string }[] };

/**
 * The committed trace has no eve session behind it, so its transcript is read from the model calls it
 * recorded: the last call's input is the conversation so far, and its output the final reply.
 */
function transcriptFromTrace(sessionId: string, records: readonly TraceRecord[]) {
  const models = records.filter((record) => record.type === "span" && record.kind === "model" && record.status !== "running");
  const last = models.at(-1);
  if (last === undefined || last.type !== "span") return { sessionId, messages: [] };
  const input = JSON.parse(JSON.stringify(last.attributes["gen_ai.input.messages"] ?? [])) as ModelMessage[];
  const output = JSON.parse(JSON.stringify(last.attributes["gen_ai.output.messages"] ?? [])) as ModelMessage[];
  const messages: { role: "user" | "assistant"; text: string; tools: string[] }[] = [];
  for (const message of input) {
    if (message.role === "user") messages.push({ role: "user", text: typeof message.content === "string" ? message.content : "", tools: [] });
    if (message.role !== "assistant") continue;
    const parts = Array.isArray(message.content) ? (message.content as { type: string; text?: string; toolName?: string }[]) : [];
    const text = parts.flatMap((part) => (part.type === "text" && part.text !== undefined ? [part.text] : [])).join("\n\n");
    const tools = parts.flatMap((part) => (part.type === "tool-call" && part.toolName !== undefined ? [part.toolName] : []));
    const previous = messages.at(-1);
    // One turn's steps read as one assistant message, as eve's transcript shows them.
    if (previous?.role === "assistant") {
      previous.text = [previous.text, text].filter(Boolean).join("\n\n");
      previous.tools.push(...tools);
    } else messages.push({ role: "assistant", text, tools });
  }
  const reply = output.flatMap((message) => message.parts ?? []).flatMap((part) => (part.type === "text" && part.content !== undefined ? [part.content] : []));
  const previous = messages.at(-1);
  if (previous?.role === "assistant") previous.text = [previous.text, ...reply].filter(Boolean).join("\n\n");
  return { sessionId, messages };
}

/**
 * The booking intent as the chat's progress rows read it at each step of the ledger: the session's
 * own `ledger_transition` events applied to the intent it settled into. On this world the provider's
 * reply times out right after it booked, so the intent is `unknown` until the status check confirms
 * it, which takes milliseconds here; the trace keeps every step.
 */
function ledgerStates(trace: GetSessionTraceResponse, settled: readonly ActionIntentView[]): ActionIntentView[][] {
  const intent = settled.find((candidate) => candidate.action === "book");
  if (intent === undefined) throw new Error("No booking intent to replay.");
  return trace.events
    .filter((event) => event.kind === "ledger_transition" && event.attributes["errand.ledger.key"] === intent.idempotencyKey)
    .map((event) => {
      const state = event.attributes["errand.ledger.state.to"] as ActionIntentView["state"];
      const resolved = state === "confirmed" || state === "failed";
      return [
        {
          ...intent,
          state,
          attempts: Number(event.attributes["errand.ledger.attempts"]),
          bookingId: (event.attributes["errand.ledger.booking_id"] as string | null) ?? null,
          resolvedAt: resolved ? intent.resolvedAt : null,
          resolvedBy: resolved ? intent.resolvedBy : null,
        },
      ];
    });
}

function assistantMessagesOf(turn: ChatTurn): EveMessage[] {
  return turn.messages.filter((message) => message.role === "assistant");
}

function toolOutput(turn: ChatTurn, name: string): unknown {
  return turn.toolCalls.findLast((call) => call.name === name)?.output;
}

function sayOf(beat: DemoBeat): string {
  switch (beat.say.kind) {
    case "text":
      return beat.say.text;
    case "choose":
      return chooseMessage(beat.say.providerName, beat.say.slot);
    case "ask-form":
      return askFormMessage({ values: beat.say.values });
    case "card":
      return CARD_FOLLOW_UPS[beat.say.follow];
  }
}

const backend = await startBackend();
try {
  const api = new ApiClient({ baseUrl: backend.url });
  const operator = new ApiClient({ baseUrl: backend.url, accessToken: await mintAccessToken({ secret: backend.secret, subject: OPERATOR_ID }) });
  const chat = new ChatClient({ baseUrl: backend.url });

  await api.switchScenario(DEMO_WORLD);
  await api.seedMemory({ facts: [...DEMO_SCRIPT.memory] });

  const recorded = {
    home: { initial: await api.getHomeSummary(), afterBooking: undefined as unknown },
    memory: await api.listMemory(),
    services: await api.listServiceOptions(),
    bookings: { initial: await api.listBookings(), afterBooking: undefined as unknown },
    // The most the spend route gives; the demo answers fewer months from the end of it.
    spend: await api.getSpend(12),
    sessions: {} as Record<string, unknown>,
    proposals: {} as Record<string, unknown>,
    intents: {} as Record<string, unknown>,
    handoffs: {} as Record<string, unknown>,
  };
  const providerIds = new Set<string>();
  const sessionIds: Record<string, string> = {};

  async function recordSession(script: DemoSessionScript): Promise<void> {
    const session = await chat.startSession();
    sessionIds[script.key] = session.id;
    const turns: ModelScriptTurn[] = script.beats.map((beat) => ({ steps: beat.steps as ModelStep[] }));
    await api.loadModelScript({ script: { turns } });
    if (script.draft !== undefined) await api.draftErrand(session.id, script.draft);
    if (script.startedFrom !== undefined) {
      const from = sessionIds[script.startedFrom.session];
      const origin = recorded.sessions[script.startedFrom.session] as { beats: { messages: EveMessage[] }[] } | undefined;
      const refused = origin?.beats
        .flatMap((beat) => beat.messages)
        .flatMap((message) => message.parts)
        .findLast((part) => part.type === "tool" && part.name === "search_providers");
      if (from === undefined || refused === undefined || refused.type !== "tool") throw new Error(`No refused search in ${script.startedFrom.session}`);
      const moved = await api.startNewErrand(from, { toolCallId: refused.callId, toSessionId: session.id, search: refused.input as SearchProvidersInput });
      recorded.handoffs[script.key] = { moved, toolCallId: refused.callId, search: refused.input };
    }
    const beats: unknown[] = [];
    for (const beat of script.beats) {
      if (beat.before?.kind === "approve") {
        const proposalId = (recorded.proposals[`${script.key}:pending`] as { proposalId: string }).proposalId;
        const pending = await api.getProposal(proposalId);
        recorded.proposals[`${script.key}:approve`] = await api.approveProposal(proposalId, { fingerprint: pending.fingerprint });
        recorded.proposals[`${script.key}:approved`] = await api.getProposal(proposalId);
      }
      if (beat.before?.kind === "decline") {
        const proposalId = (recorded.proposals[`${script.key}:pending`] as { proposalId: string }).proposalId;
        recorded.proposals[`${script.key}:decline`] = await api.declineProposal(proposalId);
        recorded.proposals[`${script.key}:declined`] = await api.getProposal(proposalId);
      }
      const say = sayOf(beat);
      // A turn that never settles fails the recording instead of hanging it.
      const turn = await chat.sendMessage(session.id, say, { signal: AbortSignal.timeout(90_000) });
      const search = toolOutput(turn, "search_providers") as { kind?: string; providers?: { id: string }[] } | undefined;
      for (const provider of search?.providers ?? []) providerIds.add(provider.id);
      const proposed = toolOutput(turn, "propose_action") as { kind?: string; proposal?: { proposalId: string } } | undefined;
      if (proposed?.kind === "proposed" && proposed.proposal !== undefined) {
        recorded.proposals[`${script.key}:pending`] = await api.getProposal(proposed.proposal.proposalId);
      }
      if (beat.executes === true) {
        recorded.intents[`${script.key}:settled`] = await api.listSessionActionIntents(session.id);
        const executed = recorded.proposals[`${script.key}:pending`] as { proposalId: string };
        recorded.proposals[`${script.key}:executed`] = await api.getProposal(executed.proposalId);
      }
      beats.push({ key: beat.key, say, messages: assistantMessagesOf(turn), errand: await api.getErrand(session.id) });
      console.error(`${script.key}/${beat.key}: ${turn.toolCalls.map((call) => `${call.name}(${call.state})`).join(", ")} → ${turn.reply.slice(0, 60)}`);
    }
    recorded.sessions[script.key] = { sessionId: session.id, draft: script.draft ?? null, beats, handoffs: await api.getErrandHandoffs(session.id) };
  }

  // A provider cancels the seeded AC booking: the backend opens a chat by itself, tells the person and
  // puts up a fresh card (the home screen's alert and "waiting on you"). The card is approved at the end,
  // after the other chats, so their bookings keep the ids they'd have without it.
  const cancellation = DEMO_SCRIPT.providerCancellation;
  await api.loadModelScript({ script: { turns: cancellation.turns.map((turn) => ({ steps: turn as ModelStep[] })) } });
  const cancelled = await api.simulateProviderCancellation(cancellation.event);
  if (cancelled.outcome.kind !== "notified") throw new Error(`The cancellation wasn't notified: ${cancelled.outcome.kind}`);
  const cancelledChat = cancelled.outcome.sessionId;
  const noticeTurn = await chat.followDelivery(cancelledChat, cancelled.outcome.deliveryId, { signal: AbortSignal.timeout(90_000) });
  const replacement = toolOutput(noticeTurn, "propose_action") as { kind?: string; proposal?: { proposalId: string } } | undefined;
  if (replacement?.proposal === undefined) throw new Error("The cancellation chat put up no card.");
  for (const provider of (toolOutput(noticeTurn, "search_providers") as { providers?: { id: string }[] } | undefined)?.providers ?? []) providerIds.add(provider.id);
  recorded.proposals["cancelled:pending"] = await api.getProposal(replacement.proposal.proposalId);
  // What the person's home screen, bookings and spend read once the cancellation is in.
  recorded.home.initial = await api.getHomeSummary();
  recorded.bookings.initial = await api.listBookings();
  recorded.spend = await api.getSpend(12);
  console.error(`cancelled/notice: ${noticeTurn.toolCalls.map((call) => call.name).join(", ")}`);

  for (const script of DEMO_SCRIPT.sessions) {
    await recordSession(script);
    if (script.key === "plumber") {
      recorded.home.afterBooking = await api.getHomeSummary();
      recorded.bookings.afterBooking = await api.listBookings();
    }
  }
  await api.loadModelScript({ script: { turns: cancellation.turns.map((turn) => ({ steps: turn as ModelStep[] })) } });
  const replacementCard = await api.getProposal(replacement.proposal.proposalId);
  recorded.proposals["cancelled:approve"] = await api.approveProposal(replacementCard.proposalId, { fingerprint: replacementCard.fingerprint });
  const approvedTurn = await chat.sendMessage(cancelledChat, CARD_FOLLOW_UPS.approved, { signal: AbortSignal.timeout(90_000) });
  recorded.proposals["cancelled:executed"] = await api.getProposal(replacementCard.proposalId);
  recorded.intents["cancelled:settled"] = await api.listSessionActionIntents(cancelledChat);
  recorded.sessions.cancelled = {
    sessionId: cancelledChat,
    draft: null,
    // The chat opens with the provider's update: the backend's message, shown as a notice, never as the person's words.
    opening: noticeTurn.messages,
    beats: [
      { key: "notice", say: null, messages: assistantMessagesOf(noticeTurn), errand: null },
      { key: "approve", say: CARD_FOLLOW_UPS.approved, messages: assistantMessagesOf(approvedTurn), errand: await api.getErrand(cancelledChat) },
    ],
    handoffs: await api.getErrandHandoffs(cancelledChat),
  };
  console.error(`cancelled/approve: ${approvedTurn.toolCalls.map((call) => call.name).join(", ")} → ${approvedTurn.reply.slice(0, 60)}`);

  // A chat's hand-offs change when a later chat moves a job out of it: read them all again at the end.
  for (const script of DEMO_SCRIPT.sessions) {
    const session = recorded.sessions[script.key] as { sessionId: string; handoffs: unknown };
    session.handoffs = await api.getErrandHandoffs(session.sessionId);
  }

  // The routes take up to 20 ids a call.
  const ids = [...providerIds].sort();
  const batches = Array.from({ length: Math.ceil(ids.length / 20) }, (_, index) => ids.slice(index * 20, index * 20 + 20));
  const providers = (await Promise.all(batches.map((batch) => api.getProviders(batch)))).flat();
  const reads = await Promise.all(batches.map((batch) => api.getAvailability(batch)));
  const availability = {
    days: (reads[0]?.days ?? []).map((day, index) => {
      const byProvider = reads.flatMap((read) => read.days[index]?.byProvider ?? []);
      return { date: day.date, freeSlots: byProvider.reduce((sum, entry) => sum + entry.freeSlots, 0), byProvider };
    }),
    unknownProviderIds: reads.flatMap((read) => read.unknownProviderIds),
  };

  const opsSessions = await operator.listOperatorSessions();
  const demoChat = sessionIds.plumber;
  if (demoChat === undefined) throw new Error("The plumber chat wasn't recorded.");
  // Each booking's ledger steps, from its chat's own trace.
  for (const script of DEMO_SCRIPT.sessions) {
    if (!script.beats.some((beat) => beat.executes === true)) continue;
    const trace = await operator.getSessionTrace(sessionIds[script.key] ?? "");
    recorded.intents[`${script.key}:during`] = ledgerStates(trace, recorded.intents[`${script.key}:settled`] as ActionIntentView[]);
  }
  const demoTrace = await operator.getSessionTrace(demoChat);
  const ops = {
    sessions: opsSessions.filter((session) => session.sessionId === demoChat),
    demoChat: {
      sessionId: demoChat,
      trace: demoTrace,
      context: await operator.getSessionContext(demoChat),
      transcript: await operator.getSessionTranscript(demoChat),
    },
    committed: await committedTrace(),
  };

  const recording = {
    note: "Generated by `pnpm demo:record` from the real backend (scripted model, pinned clock). Do not edit by hand.",
    clockStart: DEMO_CLOCK_START,
    world: DEMO_WORLD,
    ...recorded,
    providers,
    availability,
  };
  for (const [file, value] of [
    [OUTPUT, recording],
    [OPS_OUTPUT, { note: recording.note, ...ops }],
  ] as const) {
    fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
    console.error(`wrote ${path.relative(ROOT, file)} (${Math.round(fs.statSync(file).size / 1024)} KB)`);
  }
} finally {
  await backend.stop();
}
