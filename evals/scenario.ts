import { ApiClient, ChatClient, type ToolCallView } from "@errand/client";
import type { ModelScript, RunLimits, SeedFact, SwitchScenarioRequest, WorldFault } from "@errand/contracts";
import { defineEval, type EveEvalContext, type EveEvalDefinition } from "eve/evals";
import { equals } from "eve/evals/expect";

import { converse } from "./conversation";
import type { AttackVerdict } from "./injection-checks";
import { generatedUiCalls, isDrawn } from "./generated-ui-checks";
import { checkInvariants } from "./invariants";
import { evalMode, isRecording, serverEnvironmentFor, type EvalMode } from "./modes";
import { modelIdIn, modelScriptFrom, readRecording, writeRecording, type Recording } from "./recording";
import { ACTUAL_LABEL, ATTACK_LABEL, type ScenarioRun } from "./scenario-run";
import { settledTrace } from "./session-trace";
import { ScriptedUser } from "./users/scripted-user";
import { ReturningUser } from "./users/returning-user";
import { DEFAULT_SIMULATED_MESSAGES, SimulatedUser } from "./users/simulated-user";
import { isApprove, type ApproveClick, type User, type UserStep } from "./users/user";

// A scenario is one eval in the eval table, run the same way in all three modes. It declares the
// world (seed and fault profile), the scripted user, a goal for the simulated user, the scripted
// model turns, and the expected end state. Grade the final state, never the wording (τ-bench).

export interface ScenarioDefinition {
  /**
   * The eval id eve derives from the file path under evals/, e.g. `scenarios/search/plumber`.
   * eve bundles eval files, so the file can't find its own path; the reporter checks this matches.
   */
  readonly id: string;
  readonly description: string;
  /** The seeded world and its fault profile (a named world scenario such as `slot_taken`). */
  readonly world: SwitchScenarioRequest;
  /** Tighter run-budget limits for this scenario's runs (dev route); the defaults otherwise. */
  readonly runLimits?: Partial<RunLimits>;
  /** A world operation made slow or made to throw for this scenario (dev route). */
  readonly worldFault?: WorldFault;
  /** What the scripted user says and clicks, in order. */
  readonly user: readonly UserStep[];
  /** The simulated user's goal in live mode. Without one, the scenario is skipped live. */
  readonly goal?: string;
  /**
   * Goals for later chat sessions in live mode, one per `newSession` step: the same simulated person
   * coming back with a fresh chat.
   */
  readonly laterGoals?: readonly string[];
  /** What the person's memory holds when the scenario starts. Empty by default, so nothing leaks between scenarios. */
  readonly memory?: readonly SeedFact[];
  /** Cap on the simulated user's messages (default 3). */
  readonly maxSimulatedMessages?: number;
  /** A live trial's own time limit, for a scenario with more messages than the config's limit allows */
  readonly liveTimeoutMs?: number;
  /** The offline model's turns: turn n answers the nth user message. */
  readonly model: ModelScript;
  /** The expected end state in one line, for the eval table. */
  readonly expected: string;
  /** Asserts the end state. Runs unchanged in every mode. */
  expect(t: EveEvalContext, run: ScenarioRun): Promise<void> | void;
  /** The actual end state in one line, for the eval table. Defaults to the tool calls and clicks. */
  actual?(run: ScenarioRun): string;
  /**
   * For attack scenarios (prompt injection, adversarial users): did the attack land in this trial?
   * The reporter turns the verdicts into the attack success rate (ASR) in the eval table.
   */
  attack?(run: ScenarioRun): Promise<AttackVerdict>;
}

interface Plan {
  readonly user: User;
  readonly script: ModelScript | null;
  readonly world: SwitchScenarioRequest;
  readonly recording?: Recording;
}

function clicksIn(steps: readonly UserStep[]): ApproveClick[] {
  return steps.flatMap((step) => (isApprove(step) ? [step.approve] : []));
}

async function planFor(t: EveEvalContext, mode: EvalMode, definition: ScenarioDefinition): Promise<Plan> {
  switch (mode) {
    case "offline":
      return { user: new ScriptedUser(definition.user), script: definition.model, world: definition.world };
    case "replay": {
      const recording = await readRecording(definition.id);
      if (recording === undefined) {
        return t.skip(`No recording yet. Record one with ERRAND_EVAL_MODE=live ERRAND_EVAL_RECORD=1 (pnpm eval:record).`);
      }
      // A recording only replays against the world and date it was recorded in.
      await t.require(recording.clockStart, equals(serverEnvironmentFor("replay").ERRAND_CLOCK_START));
      return { user: new ScriptedUser(recording.user), script: recording.modelScript, world: recording.world, recording };
    }
    case "live": {
      if (definition.goal === undefined) return t.skip("No goal for the simulated user.");
      const maxMessages = definition.maxSimulatedMessages ?? DEFAULT_SIMULATED_MESSAGES;
      const later = (definition.laterGoals ?? []).map((goal) => new SimulatedUser({ goal, clicks: [], maxMessages }));
      const first = new SimulatedUser({ goal: definition.goal, clicks: clicksIn(definition.user), maxMessages });
      return { user: later.length === 0 ? first : new ReturningUser([first, ...later]), script: null, world: definition.world };
    }
  }
}

function describeValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function describeToolCall(call: ToolCallView): string {
  const input = typeof call.input === "object" && call.input !== null ? Object.values(call.input) : [];
  const args = input.filter((value) => typeof value === "string").map(describeValue).join(", ");
  const output = typeof call.output === "object" && call.output !== null ? (call.output as Record<string, unknown>) : {};
  const providers = Array.isArray(output.providers) ? ` (${output.providers.length} providers)` : "";
  const result = typeof output.kind === "string" ? `${output.kind}${providers}` : call.state;
  return `${call.name}(${args}) → ${result}`;
}

export function describeRun(run: ScenarioRun): string {
  const tools = run.toolCalls.length === 0 ? ["no tool calls"] : run.toolCalls.map(describeToolCall);
  const clicks = run.clicks.map((click) => `approve ${click.proposalId} → ${click.status} ${click.code}`);
  const taps = run.taps.map((tap) => `card ${tap.tap} → ${tap.status} ${tap.code}`);
  return [`${run.turns.length} turn${run.turns.length === 1 ? "" : "s"}`, ...tools, ...taps, ...clicks].join("; ");
}

async function agentCostUsd(api: ApiClient, sessionIds: readonly string[]): Promise<number> {
  let total = 0;
  for (const sessionId of sessionIds) total += (await settledTrace(api, sessionId)).totals.costUsd;
  return total;
}

async function runScenario(t: EveEvalContext, definition: ScenarioDefinition): Promise<void> {
  const mode = evalMode();
  const api = new ApiClient({ baseUrl: t.target.url });
  const chat = new ChatClient({ baseUrl: t.target.url });
  const plan = await planFor(t, mode, definition);

  // A scenario switch resets the run limits and clears any world fault, so set them after it.
  await api.switchScenario(plan.world);
  if (definition.runLimits !== undefined) await api.setRunLimits({ limits: definition.runLimits });
  if (definition.worldFault !== undefined) await api.injectWorldFault({ fault: definition.worldFault });
  await api.seedMemory({ facts: [...(definition.memory ?? [])] });
  await api.loadModelScript({ script: plan.script });
  const bookingsBefore = await api.listBookings();
  const { script } = plan;
  const conversation = await converse(plan.user, { api, chat }, t.abortSignal, {
    // The offline model counts turns within a session, so a new session plays the rest of the script.
    beforeNewSession: async (said) => {
      if (script !== null) await api.loadModelScript({ script: { turns: script.turns.slice(said) } });
    },
  });

  // Hand every turn to eve so its run-level assertions (succeeded, calledTool, ...) see them all.
  for (const sessionId of conversation.sessionIds) {
    const session = t.target.attach(sessionId, { startIndex: 0 });
    for (const _turn of conversation.turns.filter((turn) => turn.sessionId === sessionId)) await session.nextTurn();
  }

  const run: ScenarioRun = {
    ...conversation,
    mode,
    api,
    bookingsBefore,
    world: plan.world,
    clockStart: serverEnvironmentFor(mode).ERRAND_CLOCK_START,
    toolCalls: conversation.turns.flatMap((turn) => turn.toolCalls),
  };
  const costUsd = { agent: await agentCostUsd(api, run.sessionIds), simulatedUser: plan.user.costUsd };
  const actual = (definition.actual ?? describeRun)(run);
  const uiCalls = generatedUiCalls(run.turns);
  const generatedUi = {
    calls: uiCalls.length,
    parsed: uiCalls.filter((call) => call.verdict.kind !== "unreadable").length,
    drawn: uiCalls.filter(isDrawn).length,
  };
  // Tracked only (soft, no threshold): the reporter reads it for the table's "actual" column.
  t.score({ score: 1, message: actual, metadata: { actual, costUsd, generatedUi } }).label(ACTUAL_LABEL);

  if (definition.attack !== undefined) {
    const attack = await definition.attack(run);
    const message = attack.status === "held" ? "attack had no effect" : `attack ${attack.status}: ${attack.reached.join("; ")}`;
    // Tracked only, like `actual`: the scenario's own checks are the gates. An invalid trial
    // scores 0 too, so it never reads as a defence.
    t.score({ score: attack.status === "held" ? 1 : 0, message, metadata: { attack } }).label(ATTACK_LABEL);
  }

  if (mode === "live" && isRecording()) {
    const written = await writeRecording({
      scenario: definition.id,
      recordedAt: new Date().toISOString(),
      evalRunId: process.env.EVE_EVALUATION_RUN_ID,
      model: modelIdIn(run.turns),
      clockStart: serverEnvironmentFor("live").ERRAND_CLOCK_START,
      world: plan.world,
      user: [...run.steps],
      modelScript: modelScriptFrom(run.turns),
      costUsd,
    });
    t.log(written ? `recorded ${definition.id}` : `kept this run's earlier recording of ${definition.id}`);
  }

  // Invariants first: a failed `t.require` in the scenario's own checks stops the test body.
  await checkInvariants(t, run);
  await definition.expect(t, run);
}

export function defineScenario(definition: ScenarioDefinition): EveEvalDefinition {
  return defineEval({
    description: definition.description,
    tags: ["scenario"],
    metadata: { scenario: definition.id, expected: definition.expected, goal: definition.goal },
    ...(evalMode() === "live" && definition.liveTimeoutMs !== undefined ? { timeoutMs: definition.liveTimeoutMs } : {}),
    test: (t) => runScenario(t, definition),
  });
}
