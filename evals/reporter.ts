import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { EveEval, EveEvalResult } from "eve/evals";
import type { EvalReporter } from "eve/evals/reporters";

import {
  AttemptResultSchema,
  ModeResultsSchema,
  renderEvalTable,
  type AttemptResult,
  type ModeResults,
  type ScenarioResult,
} from "./eval-table";
import { INVARIANT_LABEL_PREFIX, INVARIANTS } from "./invariants";
import { EVAL_MODES, type EvalMode } from "./modes";
import { ACTUAL_LABEL, ATTACK_LABEL } from "./scenario-run";

// A custom eve reporter. After each run it writes the mode's results to evals/results/<mode>.json
// and regenerates docs/EVAL_TABLE.md from every mode's latest results.

export interface EvalTableReporterOptions {
  readonly mode: EvalMode;
  readonly trials: number;
  /** Repo root; the results and the table are written under it. */
  readonly root?: string;
}

export function resultsPath(root: string, mode: EvalMode): string {
  return path.join(root, "evals", "results", `${mode}.json`);
}

export function tablePath(root: string): string {
  return path.join(root, "docs", "EVAL_TABLE.md");
}

function metadataString(evaluation: EveEval | undefined, key: string): string | undefined {
  const value = evaluation?.metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function attackOf(result: EveEvalResult): AttemptResult["attack"] {
  const parsed = AttemptResultSchema.shape.attack.safeParse(result.assertions.find((assertion) => assertion.key === ATTACK_LABEL)?.metadata?.attack);
  return parsed.success ? parsed.data : undefined;
}

function attemptOf(result: EveEvalResult): AttemptResult {
  const actual = result.assertions.find((assertion) => assertion.key === ACTUAL_LABEL)?.metadata;
  const attack = attackOf(result);
  const costUsd = actual?.costUsd as AttemptResult["costUsd"] | undefined;
  const generatedUi = actual?.generatedUi as AttemptResult["generatedUi"] | undefined;
  return {
    verdict: result.verdict,
    actual: typeof actual?.actual === "string" ? actual.actual : undefined,
    costUsd,
    generatedUi,
    failures: result.assertions
      .filter((assertion) => assertion.severity === "gate" && (assertion.passed === false || assertion.errored))
      .map((assertion) => (assertion.message === undefined ? assertion.name : `${assertion.name}: ${assertion.message}`)),
    skipReason: result.skipReason,
    error: result.error,
    pendingInvariants: result.assertions
      .filter((assertion) => assertion.key?.startsWith(INVARIANT_LABEL_PREFIX) && assertion.metadata?.status === "pending")
      .map((assertion) => String(assertion.metadata?.invariant)),
    ...(attack === undefined ? {} : { attack }),
  };
}

async function readModeResults(root: string, mode: EvalMode): Promise<ModeResults | undefined> {
  const text = await readFile(resultsPath(root, mode), "utf8").catch(() => undefined);
  return text === undefined ? undefined : ModeResultsSchema.parse(JSON.parse(text));
}

export function evalTableReporter(options: EvalTableReporterOptions): EvalReporter {
  const root = options.root ?? process.cwd();
  const evaluations = new Map<string, EveEval>();
  const results: EveEvalResult[] = [];

  return {
    onRunStart(selected) {
      for (const evaluation of selected) {
        const declared = metadataString(evaluation, "scenario");
        if (declared !== undefined && declared !== evaluation.id) {
          throw new Error(`Scenario id "${declared}" doesn't match its file's eval id "${evaluation.id}". Fix the id.`);
        }
        evaluations.set(evaluation.id, evaluation);
      }
    },

    onEvalComplete(result) {
      results.push(result);
    },

    async onRunComplete(summary) {
      const scenarios = new Map<string, ScenarioResult>();
      for (const result of results) {
        const evaluation = evaluations.get(result.id);
        const scenario = scenarios.get(result.id) ?? {
          id: result.id,
          description: evaluation?.description ?? "",
          expected: metadataString(evaluation, "expected") ?? evaluation?.description ?? "",
          attempts: [],
        };
        scenario.attempts.push(attemptOf(result));
        scenarios.set(result.id, scenario);
      }
      const modeResults: ModeResults = {
        mode: options.mode,
        ranAt: summary.completedAt,
        trials: options.trials,
        scenarios: [...scenarios.values()].sort((a, b) => a.id.localeCompare(b.id)),
      };

      const file = resultsPath(root, options.mode);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `${JSON.stringify(modeResults, null, 2)}\n`);

      const latest: Partial<Record<EvalMode, ModeResults>> = {};
      for (const mode of EVAL_MODES) {
        const loaded = mode === options.mode ? modeResults : await readModeResults(root, mode);
        if (loaded !== undefined) latest[mode] = loaded;
      }
      await mkdir(path.dirname(tablePath(root)), { recursive: true });
      await writeFile(tablePath(root), renderEvalTable(latest, INVARIANTS));
      console.log(`Eval table: ${path.relative(root, tablePath(root))} (${options.mode} results in ${path.relative(root, file)})`);
    },
  };
}
