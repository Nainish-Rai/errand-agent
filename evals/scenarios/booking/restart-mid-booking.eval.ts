import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ApiClient, ChatClient, type ChatTurn } from "@errand/client";
import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";

import { bookingChanges } from "../../approval-checks";
import { freePort, startBackend, type BackendProcess } from "../../backend-process";
import {
  ASK_FOR_PLUMBER,
  CHEAPEST_PLUMBER,
  CHOOSE_CHEAPEST,
  executeTurn,
  FIRST_BOOKING_ID,
  HOLD_AND_PROPOSE_TURN,
  SEARCH_TURN,
} from "../../booking-conversation";
import { checkInvariants } from "../../invariants";
import { evalMode, serverEnvironmentFor } from "../../modes";
import { authEnvironment, operatorClient } from "../../operator";
import { ACTUAL_LABEL, type ScenarioRun } from "../../scenario-run";

// Ticket 07, "restart mid-booking". The backend is really killed (SIGKILL to the process group
// this eval started) after the world has taken `book` and before the backend records its reply:
// the dev fault `pause_after book` holds the reply while the eval kills the process. A new backend
// on the same files reconciles at startup through get_booking_status: exactly one booking, the
// intent confirmed by the reconciler, and the booking update the person is owed in the session.
//
// It runs its own backend rather than the eval server, which it can't kill. The scripted model
// is enough: the crash and the recovery are the backend's, not the model's, so it runs offline only.

const ID = "scenarios/booking/restart-mid-booking";
const EXPECTED =
  "the backend is SIGKILLed while book's reply is held; after restart the startup reconciler confirms the intent through get_booking_status; " +
  "exactly one booking; the proposal is executed; the session's booking update says Booked with that booking ID";
const SCRIPT = { turns: [SEARCH_TURN, HOLD_AND_PROPOSE_TURN, executeTurn(`Booked. Booking ID ${FIRST_BOOKING_ID}.`)] };
const APP_ROOT = path.resolve(import.meta.dirname ?? process.cwd(), "../../..");

async function until(condition: () => Promise<boolean>, withinMs: number): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return condition();
}

function appRoot(): string {
  // eve bundles eval files, so import.meta.dirname may not be the source folder; the eval runs from the app root.
  return fs.existsSync(path.join(APP_ROOT, "node_modules/.bin/eve")) ? APP_ROOT : process.cwd();
}

export default defineEval({
  description: "The backend is killed between sending book and recording its reply; after restart, one booking and the right update.",
  tags: ["scenario"],
  metadata: { scenario: ID, expected: EXPECTED },
  // Two backend starts (a cold `eve dev` each) on top of the conversation.
  timeoutMs: 240_000,
  async test(t) {
    if (evalMode() !== "offline") return t.skip("The crash and recovery are the backend's; the scripted model covers them offline.");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "errand-restart-"));
    const directories = {
      state: path.join(root, "eve"),
      data: path.join(root, "data"),
      traces: path.join(root, "traces"),
      logs: path.join(root, "logs"),
    };
    const environment = { ...serverEnvironmentFor("offline"), ...authEnvironment() };
    const port = await freePort();
    const start = { appRoot: appRoot(), directories, port, environment };
    let backend: BackendProcess | undefined;
    let passed = false;
    try {
      backend = await startBackend(start);
      let api = new ApiClient({ baseUrl: backend.url });
      const chat = new ChatClient({ baseUrl: backend.url });
      await api.switchScenario({ scenario: "happy_path", seed: 42 });
      await api.loadModelScript({ script: SCRIPT });
      const bookingsBefore = await api.listBookings();

      const turns: ChatTurn[] = [await chat.sendFirstMessage(ASK_FOR_PLUMBER, { signal: t.abortSignal })];
      const sessionId = turns[0]?.sessionId ?? "";
      turns.push(await chat.sendMessage(sessionId, CHOOSE_CHEAPEST, { signal: t.abortSignal }));
      const [proposal] = await api.listSessionProposals(sessionId);
      await t.require(proposal !== undefined, equals(true));
      if (proposal === undefined) return;
      await api.approveProposal(proposal.proposalId, { fingerprint: proposal.fingerprint });

      // The world takes `book` and the fault holds its reply; then the process dies.
      await api.injectWorldFault({ fault: { kind: "pause_after", operation: "book" } });
      const inFlight = new AbortController();
      const lost = chat.sendMessage(sessionId, "I approved it on the card.", { signal: inFlight.signal }).catch(() => undefined);
      const paused = await until(async () => (await api.getWorldFault()).pausedCalls === 1, 30_000);
      await t.require(paused, equals(true));
      const [beforeKill] = await api.listSessionActionIntents(sessionId);
      t.check([beforeKill?.state, beforeKill?.attempts], equals(["pending", 1])).label("book was sent; its reply is not recorded");
      await backend.kill();
      inFlight.abort();
      await lost;
      t.log(`killed backend pid ${backend.pid} mid-booking`);

      backend = await startBackend(start);
      api = new ApiClient({ baseUrl: backend.url });
      const operatorApi = await operatorClient(backend.url);
      t.log(`restarted backend pid ${backend.pid}`);

      const [intent] = await api.listSessionActionIntents(sessionId);
      t.check([intent?.state, intent?.attempts, intent?.resolvedBy], equals(["confirmed", 1, "reconciler"])).label(
        "the startup reconciler confirmed it, with no second book",
      );
      const run: ScenarioRun = {
        sessionId,
        sessionIds: [sessionId],
        turns,
        clicks: [],
        taps: [{ tap: "approve", proposalId: proposal.proposalId, status: 200, code: "approved" }],
        uiTaps: [],
        steps: [{ say: ASK_FOR_PLUMBER }, { say: CHOOSE_CHEAPEST }, { card: "approve" }],
        worldEvents: [],
        mode: "offline",
        toolCalls: turns.flatMap((turn) => turn.toolCalls),
        api,
        operatorApi,
        bookingsBefore,
        world: { scenario: "happy_path", seed: 42 },
        clockStart: environment.ERRAND_CLOCK_START,
      };
      const { made } = await bookingChanges(run);
      const actual = `after restart: intent ${intent?.state ?? "missing"} by ${intent?.resolvedBy ?? "nobody"}; ${made.length} booking(s); update: ${intent?.notice?.slice(0, 60) ?? "none"}`;
      t.score({ score: 1, message: actual, metadata: { actual, costUsd: { agent: 0, simulatedUser: 0 } } }).label(ACTUAL_LABEL);

      await checkInvariants(t, run);
      t.check(made.map((booking) => [booking.bookingId, booking.providerId, booking.slot.start]), equals([
        [FIRST_BOOKING_ID, CHEAPEST_PLUMBER.providerId, CHEAPEST_PLUMBER.slot.start],
      ])).label("exactly one booking");
      t.check(intent?.bookingId, equals(FIRST_BOOKING_ID));
      const [after] = await api.listSessionProposals(sessionId);
      t.check([after?.status, after?.bookingId], equals(["executed", FIRST_BOOKING_ID])).label("the proposal is executed");
      t.check(intent?.notice, equals(
        `Update on your booking: the provider confirmed it. Booked: Shiva Sanitary Solutions, Thu, 5 Nov, 8:00 am IST, ₹399. Booking ID ${FIRST_BOOKING_ID}.`,
      )).label("the person gets the right message");
      passed = true;
    } finally {
      await backend?.stop();
      if (passed) fs.rmSync(root, { recursive: true, force: true });
      else t.log(`kept the restarted backend's files for a look: ${root}`);
    }
  },
});
