// `pnpm observatory`: turns run traces into the single-file observability dashboard.
//
//   pnpm observatory                       traces/ (after `pnpm eval` or a local session)
//   pnpm observatory --traces <dir>        another run's trace directory (repeatable)
//   pnpm observatory --fixtures            adds observatory/fixtures (503-then-retry, timeout-then-verify)
//   pnpm observatory --claude-sessions     adds the Claude Code sessions that built this repo, redacted
//                    [--claude-match <t>]  only project folders whose name contains <t> (repeatable)
//   pnpm observatory --out <file.html>     somewhere other than observatory/out/dashboard.html
//
// The analyzer and the dashboard are Python stdlib and HTML in observatory/ (copied from
// harness-observatory, MIT). Output lands in observatory/out/, which git ignores.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const observatory = path.join(root, "observatory");

const { values } = parseArgs({
  options: {
    traces: { type: "string", multiple: true },
    fixtures: { type: "boolean", default: false },
    "claude-sessions": { type: "boolean", default: false },
    "claude-match": { type: "string", multiple: true },
    days: { type: "string" },
    out: { type: "string" },
  },
});

const out = path.resolve(values.out ?? path.join(observatory, "out", "dashboard.html"));
const summary = out.replace(/\.html?$/, "") + ".summary.json";
mkdirSync(path.dirname(out), { recursive: true });

const traceDirs = [...(values.traces ?? [])];
if (traceDirs.length === 0 && existsSync(path.join(root, "traces"))) traceDirs.push("traces");
if (values.fixtures) traceDirs.push(path.join("observatory", "fixtures"));

const analyzerArgs = ["--out", summary, ...traceDirs.flatMap((dir) => ["--traces", dir])];
if (values["claude-sessions"]) analyzerArgs.push("--claude-sessions");
for (const match of values["claude-match"] ?? []) analyzerArgs.push("--claude-match", match);
if (values.days !== undefined) analyzerArgs.push("--days", values.days);

function python(script: string, args: readonly string[]): void {
  // -I: isolated mode, so nothing in the working directory or the environment shapes the run.
  const run = spawnSync("python3", ["-I", path.join(observatory, script), ...args], { cwd: root, stdio: "inherit" });
  if (run.error !== undefined) throw run.error;
  if (run.status !== 0) process.exit(run.status ?? 1);
}

python("harness_summary.py", analyzerArgs);
python("render_dashboard.py", ["--summary", summary, "--out", out]);
// The build transcripts are the only input with prompt text: prove none of it got through.
if (values["claude-sessions"]) python("check_redaction.py", [out]);
console.log(`dashboard: ${out}`);
console.log(`open it:   open ${JSON.stringify(out)}`);
