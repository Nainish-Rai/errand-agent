import { ApiClient, ChatClient, type ToolCallView } from "@errand/client";
import type { ModelScript, SwitchScenarioRequest } from "@errand/contracts";
import { defineEval, type EveEvalContext, type EveEvalDefinition } from "eve/evals";
import { equals } from "eve/evals/expect";

import { converse } from "./conversation";
import { checkInvariants } from "./invariants";
import { evalMode, isRecording, serverEnvironmentFor, type EvalMode } from "./modes";
import { modelIdIn, modelScriptFrom, readRecording, writeRecording, type Recording } from "./recording";
import { ACTUAL_LABEL, type ScenarioRun } from "./scenario-run";
import { settledTrace } from "./session-trace";
import { ScriptedUser } from "./users/scripted-user";
import { DEFAULT_SIMULATED_MESSAGES, SimulatedUser } from "./users/simulated-user";
import { isSay, type ApproveClick, type User, type UserStep } from "./users/user";

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
  /** What the scripted user says and clicks, in order. */
  readonly user: readonly UserStep[];
  /** The simulated user's goal in live mode. Without one, the scenario is skipped live. */
  readonly goal?: string;
  /** Cap on the simulated user's messages (default 3). */
  readonly maxSimulatedMessages?: number;
  /** The offline model's turns: turn n answers the nth user message. */
  readonly model: ModelScript;
  /** The expected end state in one line, for the eval table. */
  readonly expected: string;
  /** Asserts the end state. Runs unchanged in every mode. */
  expect(t: EveEvalContext, run: ScenarioRun): Promise<void> | void;
  /** The actual end state in one line, for the eval table. Defaults to the tool calls and clicks. */
  actual?(run: ScenarioRun): string;
}

interface Plan {
  readonly user: User;
  readonly script: ModelScript | null;
  readonly world: SwitchScenarioRequest;
  readonly recording?: Recording;
}

function clicksIn(steps: readonly UserStep[]): ApproveClick[] {
  return steps.flatMap((step) => (isSay(step) ? [] : [step.approve]));
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
    case "live":
      if (definition.goal === undefined) return t.skip("No goal for the simulated user.");
      return {
        user: new SimulatedUser({
          goal: definition.goal,
          clicks: clicksIn(definition.user),
          maxMessages: definition.maxSimulatedMessages ?? DEFAULT_SIMULATED_MESSAGES,
        }),
        script: null,
        world: definition.world,
      };
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
  return [`${run.turns.length} turn${run.turns.length === 1 ? "" : "s"}`, ...tools, ...clicks].join("; ");
}

async function agentCostUsd(api: ApiClient, sessionId: string): Promise<number> {
  return (await settledTrace(api, sessionId)).totals.costUsd;
}

async function runScenario(t: EveEvalContext, definition: ScenarioDefinition): Promise<void> {
  const mode = evalMode();
  const api = new ApiClient({ baseUrl: t.target.url });
  const chat = new ChatClient({ baseUrl: t.target.url });
  const plan = await planFor(t, mode, definition);

  await api.switchScenario(plan.world);
  await api.loadModelScript({ script: plan.script });
  const conversation = await converse(plan.user, { api, chat }, t.abortSignal);

  // Hand every turn to eve so its run-level assertions (succeeded, calledTool, ...) see them all.
  const session = t.target.attach(conversation.sessionId, { startIndex: 0 });
  for (const _turn of conversation.turns) await session.nextTurn();

  const run: ScenarioRun = {
    ...conversation,
    mode,
    api,
    toolCalls: conversation.turns.flatMap((turn) => turn.toolCalls),
  };
  const costUsd = { agent: await agentCostUsd(api, run.sessionId), simulatedUser: plan.user.costUsd };
  const actual = (definition.actual ?? describeRun)(run);
  // Tracked only (soft, no threshold): the reporter reads it for the table's "actual" column.
  t.score({ score: 1, message: actual, metadata: { actual, costUsd } }).label(ACTUAL_LABEL);

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
    test: (t) => runScenario(t, definition),
  });
}
