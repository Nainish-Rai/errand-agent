// The three eval modes run the same scenarios; only the model and the user change.
// - offline (default, CI): the scenario's scripted model turns and scripted user.
// - replay: a recorded live run's model turns and user, played back with no network.
// - live: MiniMax as the agent and a simulated user (Claude Code CLI), k trials each.
// ERRAND_EVAL_MODE picks one. The backend learns its side through the environment set here, which
// the eve eval server inherits because evals.config.ts loads before the server starts.

export type EvalMode = "offline" | "replay" | "live";

export const EVAL_MODES: readonly EvalMode[] = ["offline", "replay", "live"];

/** Wednesday 4 November 2026, 09:00 IST: the date every eval's world and "this week" start from. */
export const EVAL_CLOCK_START = "2026-11-04T09:00:00+05:30";

const DEFAULT_LIVE_TRIALS = 3;

type Environment = Readonly<Record<string, string | undefined>>;

export class EvalModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalModeError";
  }
}

function isEvalMode(value: string): value is EvalMode {
  return (EVAL_MODES as readonly string[]).includes(value);
}

export function evalMode(environment: Environment = process.env): EvalMode {
  const mode = environment.ERRAND_EVAL_MODE?.trim() || "offline";
  if (!isEvalMode(mode)) {
    throw new EvalModeError(`ERRAND_EVAL_MODE must be one of ${EVAL_MODES.join(", ")}; got "${mode}".`);
  }
  return mode;
}

/** ERRAND_EVAL_RECORD=1 in live mode saves each scenario's first trial as a replay fixture. */
export function isRecording(environment: Environment = process.env): boolean {
  const recording = environment.ERRAND_EVAL_RECORD === "1";
  if (recording && evalMode(environment) !== "live") {
    throw new EvalModeError("ERRAND_EVAL_RECORD=1 records live runs; set ERRAND_EVAL_MODE=live too.");
  }
  return recording;
}

/** k, the number of trials per scenario: ERRAND_EVAL_TRIALS in live mode, one otherwise. */
export function trialsFor(mode: EvalMode, environment: Environment = process.env): number {
  if (mode !== "live") return 1;
  const trials = Number(environment.ERRAND_EVAL_TRIALS ?? DEFAULT_LIVE_TRIALS);
  if (!Number.isInteger(trials) || trials < 1) {
    throw new EvalModeError(`ERRAND_EVAL_TRIALS must be a positive integer; got "${environment.ERRAND_EVAL_TRIALS}".`);
  }
  return trials;
}

/** Sets `main` in ERRAND_MODELS and keeps any other role the caller chose. */
function withMainModel(setting: string | undefined, provider: "scripted" | "minimax"): string {
  const others = (setting ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "" && !entry.startsWith("main="));
  return [`main=${provider}`, ...others].join(",");
}

/** What the backend needs for the mode: its models and a pinned clock. */
export interface ServerEnvironment {
  readonly ERRAND_MODELS: string;
  readonly ERRAND_CLOCK_START: string;
}

/**
 * Offline and replay runs touch no network, so the review reader is the scripted one there unless
 * the caller picked a reader. Live keeps the default reader (Claude Code, MiniMax as fallback).
 */
function withOfflineReviewReader(setting: string): string {
  return setting.split(",").some((entry) => entry.startsWith("review_reader=")) ? setting : `${setting},review_reader=scripted`;
}

export function serverEnvironmentFor(mode: EvalMode, environment: Environment = process.env): ServerEnvironment {
  const models = withMainModel(environment.ERRAND_MODELS, mode === "live" ? "minimax" : "scripted");
  return {
    ERRAND_MODELS: mode === "live" ? models : withOfflineReviewReader(models),
    ERRAND_CLOCK_START: environment.ERRAND_CLOCK_START?.trim() || EVAL_CLOCK_START,
  };
}
