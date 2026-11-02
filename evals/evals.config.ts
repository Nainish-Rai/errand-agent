import { defineEvalConfig } from "eve/evals";

import { evalMode, isRecording, serverEnvironmentFor, trialsFor } from "./modes";
import { evalTableReporter } from "./reporter";

// `pnpm eval` runs offline (the default). ERRAND_EVAL_MODE=replay or live switches the mode; see
// modes.ts. This module loads before eve starts the eval server, and the server inherits the
// environment set here: its main model and a pinned clock.

const mode = evalMode();
isRecording(); // refuses ERRAND_EVAL_RECORD outside live mode before anything runs
Object.assign(process.env, serverEnvironmentFor(mode));
const trials = trialsFor(mode);

export default defineEvalConfig({
  // One server holds one world and one loaded model script, so scenarios take turns.
  maxConcurrency: 1,
  repeat: trials,
  // A live trial waits on MiniMax and on the Claude Code CLI (about 12 s a call) for each message.
  timeoutMs: mode === "live" ? 300_000 : 60_000,
  reporters: [evalTableReporter({ mode, trials })],
});
