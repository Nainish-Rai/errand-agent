import { z } from "zod";

import type { Invariant } from "./invariants";
import { EVAL_MODES, type EvalMode } from "./modes";
import { passHatK } from "./pass-hat-k";

// The eval table, rendered from the per-mode results the reporter writes. docs/EVAL_TABLE.md is
// only ever this function's output.

export const AttemptResultSchema = z.object({
  verdict: z.enum(["passed", "failed", "scored", "skipped"]),
  actual: z.string().optional(),
  costUsd: z.object({ agent: z.number(), simulatedUser: z.number() }).optional(),
  /** Messages of the gates that failed. */
  failures: z.array(z.string()),
  skipReason: z.string().optional(),
  error: z.string().optional(),
  /** Invariants still pending, by id. */
  pendingInvariants: z.array(z.string()),
});

export const ScenarioResultSchema = z.object({
  id: z.string(),
  description: z.string(),
  expected: z.string(),
  attempts: z.array(AttemptResultSchema),
});

export const ModeResultsSchema = z.object({
  mode: z.enum(EVAL_MODES as [EvalMode, ...EvalMode[]]),
  ranAt: z.string(),
  trials: z.number().int().positive(),
  scenarios: z.array(ScenarioResultSchema),
});

export type AttemptResult = z.infer<typeof AttemptResultSchema>;
export type ScenarioResult = z.infer<typeof ScenarioResultSchema>;
export type ModeResults = z.infer<typeof ModeResultsSchema>;

const MODE_HEADINGS: Record<EvalMode, { readonly title: string; readonly about: string; readonly command: string }> = {
  offline: {
    title: "Offline",
    about: "Scripted model turns and a scripted user. No key, no network. CI runs this.",
    command: "pnpm eval",
  },
  replay: {
    title: "Replay",
    about: "Recorded live MiniMax runs played back through the scripted model, with no network.",
    command: "pnpm eval:replay",
  },
  live: {
    title: "Live",
    about: "MiniMax as the agent and a simulated user (Claude Code CLI), k trials per scenario.",
    command: "pnpm eval:live",
  },
};

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim() || "—";
}

function row(cells: readonly string[]): string {
  return `| ${cells.map(cell).join(" | ")} |`;
}

function usd(amount: number): string {
  return `$${amount.toFixed(4)}`;
}

const VERDICT_LABELS: Record<AttemptResult["verdict"], string> = {
  passed: "PASS",
  failed: "FAIL",
  scored: "SCORED",
  skipped: "SKIP",
};

/** Trials that ran to a verdict; skipped ones say nothing about the agent. */
function graded(scenario: ScenarioResult): AttemptResult[] {
  return scenario.attempts.filter((attempt) => attempt.verdict !== "skipped");
}

function resultOf(scenario: ScenarioResult): string {
  const attempts = graded(scenario);
  if (attempts.length === 0) return "SKIP";
  const passed = attempts.filter((attempt) => attempt.verdict === "passed").length;
  const notPassed = attempts.find((attempt) => attempt.verdict !== "passed");
  const verdict = notPassed === undefined ? "PASS" : VERDICT_LABELS[notPassed.verdict];
  return attempts.length === 1 ? verdict : `${verdict} (${passed}/${attempts.length})`;
}

function notesOf(scenario: ScenarioResult): string {
  const notes = new Set<string>();
  for (const attempt of scenario.attempts) {
    if (attempt.skipReason !== undefined) notes.add(`skipped: ${attempt.skipReason}`);
    if (attempt.error !== undefined) notes.add(`error: ${attempt.error}`);
    for (const failure of attempt.failures) notes.add(`failed: ${failure}`);
  }
  const pending = scenario.attempts[0]?.pendingInvariants.length ?? 0;
  if (pending > 0) notes.add(`${pending} invariants pending`);
  const costs = scenario.attempts.flatMap((attempt) => (attempt.costUsd === undefined ? [] : [attempt.costUsd]));
  const agent = costs.reduce((sum, cost) => sum + cost.agent, 0);
  const user = costs.reduce((sum, cost) => sum + cost.simulatedUser, 0);
  if (agent + user > 0) notes.add(`cost ${usd(agent + user)} (agent ${usd(agent)}, simulated user ${usd(user)})`);
  return [...notes].join("; ");
}

function lastActual(scenario: ScenarioResult): string {
  return scenario.attempts.findLast((attempt) => attempt.actual !== undefined)?.actual ?? "";
}

function passRates(scenario: ScenarioResult, k: number): [string, string] {
  const attempts = graded(scenario);
  if (attempts.length === 0) return ["—", "—"];
  const passed = attempts.filter((attempt) => attempt.verdict === "passed").length;
  const atK = Math.min(k, attempts.length);
  return [passHatK(passed, attempts.length, 1).toFixed(2), passHatK(passed, attempts.length, atK).toFixed(2)];
}

function summaryOf(results: ModeResults): string {
  const counts = new Map<string, number>();
  for (const scenario of results.scenarios) {
    const verdict = resultOf(scenario).split(" ")[0] ?? "";
    counts.set(verdict, (counts.get(verdict) ?? 0) + 1);
  }
  const parts = [...counts].map(([verdict, count]) => `${count} ${verdict}`);
  return `${results.scenarios.length} evals: ${parts.join(", ")}`;
}

function modeSection(mode: EvalMode, results: ModeResults | undefined): string[] {
  const heading = MODE_HEADINGS[mode];
  const lines = [`## ${heading.title}`, "", heading.about, ""];
  if (results === undefined) return [...lines, `Not run yet. Run \`${heading.command}\`.`, ""];

  const k = results.trials;
  lines.push(`Last run ${results.ranAt} with \`${heading.command}\`${mode === "live" ? `, k = ${k}` : ""}. ${summaryOf(results)}.`, "");
  if (mode === "live") {
    lines.push(row(["Scenario", "Expected", "Actual (last trial)", "Pass/fail", "pass^1", `pass^k (k=${k})`, "Notes"]));
    lines.push(row(["---", "---", "---", "---", "---", "---", "---"]));
    for (const scenario of results.scenarios) {
      lines.push(row([scenario.id, scenario.expected, lastActual(scenario), resultOf(scenario), ...passRates(scenario, k), notesOf(scenario)]));
    }
  } else {
    lines.push(row(["Scenario", "Expected", "Actual", "Pass/fail", "Notes"]));
    lines.push(row(["---", "---", "---", "---", "---"]));
    for (const scenario of results.scenarios) {
      lines.push(row([scenario.id, scenario.expected, lastActual(scenario), resultOf(scenario), notesOf(scenario)]));
    }
  }
  return [...lines, ""];
}

function invariantSection(invariants: readonly Invariant[]): string[] {
  return [
    "## Global invariants",
    "",
    "Checked after every scenario in every mode. A pending invariant is recorded with no pass rule, so it never counts as passing.",
    "",
    row(["Invariant", "Status"]),
    row(["---", "---"]),
    ...invariants.map((invariant) =>
      row([invariant.statement, invariant.check === undefined ? `pending until ticket ${invariant.realIn}` : "checked"]),
    ),
    "",
  ];
}

export function renderEvalTable(
  results: Partial<Record<EvalMode, ModeResults>>,
  invariants: readonly Invariant[],
): string {
  return [
    "# Eval table",
    "",
    "<!-- Generated by evals/reporter.ts from evals/results/<mode>.json after every eval run. Do not edit by hand. -->",
    "",
    "Generated by the eval run itself; never edited by hand. Each mode's section is its latest run.",
    "",
    ...EVAL_MODES.flatMap((mode) => modeSection(mode, results[mode])),
    ...invariantSection(invariants),
  ].join("\n");
}
