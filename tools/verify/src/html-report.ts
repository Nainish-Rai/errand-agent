import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { ScenarioResult, SuiteReport } from "./suite-report";

// A standalone report.html beside report.json: every screenshot embedded as a data URI, a strict
// Content-Security-Policy, and nothing loaded from anywhere. It refuses to call a suite PASS
// without screenshot evidence, and never overwrites an earlier report.

const IMAGE_LIMIT = 25 * 1024 * 1024;
const TOTAL_LIMIT = 80 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);

interface Embedded {
  readonly name: string;
  readonly data?: string;
  readonly sha256?: string;
  readonly error?: string;
}

function isInside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** Reads a screenshot only from inside the suite's own evidence directory. */
function embed(suiteDirectory: string, scenarioDirectory: string, name: string, budget: { used: number }): Embedded {
  if (path.basename(name) !== name) return { name, error: "not a file name" };
  let file: string;
  try {
    file = fs.realpathSync(path.join(scenarioDirectory, name));
  } catch {
    return { name, error: "missing" };
  }
  if (!isInside(suiteDirectory, file)) return { name, error: "outside the suite's evidence" };
  const data = fs.readFileSync(file);
  if (data.length > IMAGE_LIMIT) return { name, error: "too large" };
  if (!data.subarray(0, 8).equals(PNG_SIGNATURE)) return { name, error: "not a PNG" };
  if (budget.used + data.length > TOTAL_LIMIT) return { name, error: "report size budget reached" };
  budget.used += data.length;
  return { name, sha256: crypto.createHash("sha256").update(data).digest("hex"), data: `data:image/png;base64,${data.toString("base64")}` };
}

const badge = (status: string) => `<span class="badge ${status === "PASS" ? "pass" : status === "BLOCKED" ? "blocked" : status === "NOT RUN" ? "idle" : "fail"}">${escapeHtml(status)}</span>`;

function figure(shot: Embedded, caption: string): string {
  if (shot.data === undefined) return `<p class="warning">${escapeHtml(caption)}: ${escapeHtml(shot.name)} not embedded (${escapeHtml(shot.error)})</p>`;
  return `<figure><img src="${shot.data}" alt="${escapeHtml(caption)}"><figcaption>${escapeHtml(caption)}<br><small>${escapeHtml(shot.name)} · SHA-256 <code>${escapeHtml(shot.sha256)}</code></small></figcaption></figure>`;
}

function table(rows: readonly Record<string, unknown>[], columns: readonly string[]): string {
  const head = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
  const body = rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row[column] ?? "—")}</td>`).join("")}</tr>`).join("");
  return `<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function scenarioSection(scenario: ScenarioResult, suiteDirectory: string, budget: { used: number }): { html: string; embedded: number } {
  let embedded = 0;
  const shots = scenario.steps.flatMap((step) =>
    step.screenshots.map((name) => {
      const shot = embed(suiteDirectory, scenario.evidence, name, budget);
      if (shot.data !== undefined) embedded++;
      const moment = name.includes("action") ? "before the action" : "settled outcome";
      return figure(shot, `Step ${step.index} ${step.command}${step.note ? ` · ${step.note}` : ""} · ${step.status} (${moment})`);
    }),
  );
  const failure = scenario.failureScreenshot === undefined ? "" : figure(embed(suiteDirectory, scenario.evidence, scenario.failureScreenshot, budget), "Failure state");
  const rows = scenario.steps.map((step) => ({ step: step.index, phase: step.phase, command: step.command, proves: step.note, status: step.status, ms: step.durationMs, error: step.error }));
  const html = `<section><h2>${badge(scenario.status)} ${escapeHtml(scenario.title)}</h2>
<p><code>${escapeHtml(scenario.id)}</code> · theme ${escapeHtml(scenario.theme)} · viewport ${escapeHtml(scenario.viewport)} · ${escapeHtml(scenario.durationMs)} ms · context closed: ${escapeHtml(scenario.contextClosed ?? "—")}</p>
${scenario.error ? `<p class="warning">${escapeHtml(scenario.error)}</p>` : ""}
${table(rows, ["step", "phase", "command", "proves", "status", "ms", "error"])}
${failure}${shots.join("")}</section>`;
  return { html, embedded };
}

export function writeHtmlReport(report: SuiteReport): string {
  if (report.status === "PASS" && (!report.ok || report.scenarios.some((scenario) => scenario.status !== "PASS"))) throw new Error("Contradictory PASS report");
  if (report.status !== "PASS" && report.ok) throw new Error("A failed report cannot be ok");
  const suiteDirectory = fs.realpathSync(path.dirname(report.report));
  const budget = { used: 0 };
  const sections = report.scenarios.map((scenario) => scenarioSection(scenario, suiteDirectory, budget));
  if (report.status === "PASS" && report.scenarios.some((_, index) => (sections[index]?.embedded ?? 0) === 0)) {
    throw new Error("PASS needs screenshot evidence in every scenario");
  }
  const provenance = Object.entries(report.provenance).map(([field, value]) => ({ field, value }));
  const counts = Object.entries(report.counts).map(([status, count]) => `${status} ${count}`).join(" · ");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}"><title>${escapeHtml(report.title)}: ${escapeHtml(report.status)}</title><style>
:root{font-family:system-ui,sans-serif;color:#1d2433;background:#f4f5f8}body{margin:0}main{max-width:1180px;margin:auto;padding:32px 16px}
h1{font-size:30px;margin:12px 0}h2{margin-top:0;font-size:20px}p{line-height:1.55}
section,details{background:#fff;border:1px solid #dde1ea;border-radius:12px;padding:18px;margin:18px 0}
.badge{display:inline-block;padding:4px 12px;border-radius:20px;font-weight:600;font-size:14px}.pass{background:#d9f2e3;color:#145b35}
.fail{background:#fde3d8;color:#8e2b10}.blocked{background:#fdf0c8;color:#6b4a00}.idle{background:#e4e7ee;color:#3a4255}
.warning{background:#fff4e5;border-left:4px solid #e08a00;padding:8px 12px;border-radius:6px}.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid #e6e9f0;padding:6px 8px;text-align:left;vertical-align:top}
figure{margin:16px 0}img{max-width:100%;border:1px solid #dde1ea;border-radius:8px}figcaption{font-size:13px;color:#4a5368}code{font-size:12px}
pre{white-space:pre-wrap;font-size:12px}</style></head><body><main>
${badge(report.status)}<h1>${escapeHtml(report.title)}</h1>
<p>${escapeHtml(report.description ?? "")}</p>
<p>Feature <code>${escapeHtml(report.feature)}</code> · started ${escapeHtml(report.startedAt)} · ${escapeHtml(report.durationMs)} ms · ${escapeHtml(counts)}</p>
<section><h2>Source and scope</h2>${table(provenance, ["field", "value"])}<p><small>Manifest ${escapeHtml(report.manifest)} · SHA-256 <code>${escapeHtml(report.manifestDigest)}</code></small></p></section>
${sections.map((section) => section.html).join("\n")}
<details><summary>Report JSON</summary><pre>${escapeHtml(JSON.stringify(report, null, 2))}</pre></details></main></body></html>`;
  const output = path.join(suiteDirectory, "report.html");
  fs.writeFileSync(output, html, { flag: "wx", mode: 0o600 });
  return output;
}
