import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ChatTurn } from "@errand/client";
import { ModelScriptSchema, SwitchScenarioRequestSchema, type ModelScript, type ModelStep } from "@errand/contracts";
import { z } from "zod";

import { UserStepSchema } from "./users/user";

// A recording is one live run turned into a replay fixture: what the user did, and every model
// response as a scripted model step. Replay loads the steps into the backend's offline model and
// replays the user, so the agent's tools run for real against the same seeded world and pinned
// clock, with no model on the network.

export const RecordingSchema = z.object({
  scenario: z.string(),
  recordedAt: z.string(),
  /** The eve eval run that wrote it; a run records each scenario's first trial only. */
  evalRunId: z.string().optional(),
  model: z.string(),
  clockStart: z.string(),
  world: SwitchScenarioRequestSchema,
  user: z.array(UserStepSchema),
  modelScript: ModelScriptSchema,
  costUsd: z.object({ agent: z.number(), simulatedUser: z.number() }),
});

export type Recording = z.infer<typeof RecordingSchema>;

export const RECORDINGS_DIRECTORY = path.join("evals", "fixtures", "recorded");

export function recordingPath(scenarioId: string): string {
  return path.resolve(process.cwd(), RECORDINGS_DIRECTORY, `${scenarioId}.json`);
}

export async function readRecording(scenarioId: string): Promise<Recording | undefined> {
  const text = await readFile(recordingPath(scenarioId), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  return text === undefined ? undefined : RecordingSchema.parse(JSON.parse(text));
}

/** Writes the recording unless this eval run already recorded the scenario (an earlier trial won). */
export async function writeRecording(recording: Recording): Promise<boolean> {
  const existing = await readRecording(recording.scenario);
  if (existing?.evalRunId !== undefined && existing.evalRunId === recording.evalRunId) return false;
  const file = recordingPath(recording.scenario);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(RecordingSchema.parse(recording), null, 2)}\n`);
  return true;
}

interface RunEvent {
  readonly type: string;
  readonly data?: unknown;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** One model run (`run_*`) in a turn's event stream is one model response, so one scripted step. */
function stepsOf(turn: ChatTurn): ModelStep[] {
  const runs = new Map<string, { text: string[]; toolCalls: { name: string; input: Record<string, unknown> }[] }>();
  for (const event of turn.events as readonly RunEvent[]) {
    const data = record(event.data);
    if (event.type === "model.requested" && typeof data.runId === "string") {
      runs.set(data.runId, { text: [], toolCalls: [] });
    }
    if (event.type === "content.completed" && data.kind === "text" && typeof data.value === "string") {
      runs.get(String(data.runId))?.text.push(data.value);
    }
    const capability = record(data.capability);
    if (event.type === "call.requested" && capability.kind === "tool" && typeof capability.name === "string") {
      runs.get(String(record(data.owner).runId))?.toolCalls.push({ name: capability.name, input: record(data.input) });
    }
  }
  return [...runs.values()].map(({ text, toolCalls }) => ({
    // A run that only called tools has no text; a run with neither keeps an empty reply so the
    // replayed conversation has the same number of model responses.
    ...(text.length > 0 || toolCalls.length === 0 ? { text: text.join("\n\n") } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  }));
}

export function modelScriptFrom(turns: readonly ChatTurn[]): ModelScript {
  return { turns: turns.map((turn) => ({ steps: stepsOf(turn) })) };
}

export function modelIdIn(turns: readonly ChatTurn[]): string {
  for (const event of turns.flatMap((turn) => turn.events) as readonly RunEvent[]) {
    const modelId = record(event.data).modelId;
    if (event.type === "model.started" && typeof modelId === "string") return modelId;
  }
  return "unknown";
}
