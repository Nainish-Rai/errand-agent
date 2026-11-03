import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { CommandFailure, parseTheme, parseViewport, type BrowserHost, type BrowserSession, type DoctorContext } from "./browser-session";
import type { Options } from "./cli-arguments";
import type { Redactor } from "./redaction";
import { ensurePrivateDir, writePrivateJson } from "./run-paths";
import { writeHtmlReport } from "./html-report";
import type { RunState } from "./runtime";
import type { ScenarioResult, ScenarioStatus, SuiteReport } from "./suite-report";

// `suite FILE.json`: each scenario runs in a fresh browser context (its own storage, guard and
// evidence directory). A broken setup (context, doctor, world seeding) is BLOCKED; a product that
// does not do what a step expects is FAIL. Later steps of a stopped scenario stay NOT RUN.

type StepOptionValue = string | number | boolean | Record<string, unknown> | unknown[];

export interface SuiteStep {
  readonly command: string;
  readonly args?: readonly string[];
  readonly options?: Readonly<Record<string, StepOptionValue>>;
  /** What the step proves, shown in the report. */
  readonly note?: string;
}

export interface SuiteScenario {
  readonly id: string;
  readonly title: string;
  readonly theme?: "dark" | "light";
  readonly viewport?: string;
  readonly setup?: readonly SuiteStep[];
  readonly steps: readonly SuiteStep[];
}

export interface Suite {
  readonly version: 1;
  readonly title: string;
  readonly feature: string;
  readonly description?: string;
  readonly scenarios: readonly SuiteScenario[];
}

const TARGET = ["role", "name", "text", "label", "testid", "nth", "timeoutMs"];
const STEP_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  goto: [],
  reload: [],
  click: [...TARGET, "clicks"],
  hover: TARGET,
  fill: [...TARGET, "value"],
  type: [],
  key: [],
  wait: [...TARGET, "state"],
  assert: [...TARGET, "value", "count", "attr", "state", "url"],
  api: ["body", "expect", "timeoutMs", "as", "status"],
  viewport: [],
  theme: [],
  screenshot: ["viewport"],
  snapshot: TARGET,
};
const SETUP_COMMANDS = new Set(["api", "goto", "theme", "viewport"]);
const ACTIONS = new Set(["goto", "reload", "click", "hover", "fill", "type", "key"]);
const ARG_COUNT: Readonly<Record<string, readonly [number, number]>> = {
  goto: [1, 1],
  type: [1, 1],
  key: [1, 1],
  viewport: [1, 1],
  theme: [1, 1],
  api: [2, 2],
  screenshot: [0, 1],
  snapshot: [0, 1],
};

const isAssertion = (step: SuiteStep) =>
  step.command === "assert" || (step.command === "api" && (step.options?.expect !== undefined || step.options?.status !== undefined));

function fail(message: string): never {
  throw new Error(`Invalid suite: ${message}`);
}

function checkStep(step: SuiteStep, where: string, allowed: ReadonlySet<string> | undefined): void {
  if (step === null || typeof step !== "object") fail(`${where} is not an object`);
  for (const key of Object.keys(step)) if (!["command", "args", "options", "note"].includes(key)) fail(`${where} has unknown field ${key}`);
  const options = STEP_OPTIONS[step.command];
  if (options === undefined || (allowed !== undefined && !allowed.has(step.command))) fail(`${where} uses unsupported command ${JSON.stringify(step.command)}`);
  const args = step.args ?? [];
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) fail(`${where} args must be strings`);
  const [min, max] = ARG_COUNT[step.command] ?? [0, 1];
  if (args.length < min || args.length > max) fail(`${where} (${step.command}) takes ${min === max ? min : `${min}-${max}`} argument(s)`);
  for (const key of Object.keys(step.options ?? {})) if (!options.includes(key)) fail(`${where} (${step.command}) has unknown option ${key}`);
  if (step.command === "assert" && !["text", "value", "count", "attr", "state", "url"].some((key) => step.options?.[key] !== undefined)) {
    fail(`${where} asserts nothing: give text, value, count, attr, state or url`);
  }
  if (step.command === "goto" && (!args[0]?.startsWith("/") || args[0].startsWith("//"))) fail(`${where} goto takes a route such as /design`);
  if (step.command === "viewport") parseViewport(args[0] ?? "");
  if (step.command === "theme") parseTheme(args[0]);
}

export function validateSuite(value: unknown): Suite {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("the file is not a JSON object");
  const suite = value as Suite;
  for (const key of Object.keys(suite)) if (!["version", "title", "feature", "description", "scenarios", "$schema"].includes(key)) fail(`unknown field ${key}`);
  if (suite.version !== 1) fail("version must be 1");
  if (typeof suite.title !== "string" || typeof suite.feature !== "string") fail("title and feature are required strings");
  const scenarios: readonly SuiteScenario[] = suite.scenarios;
  if (!Array.isArray(scenarios) || scenarios.length === 0 || scenarios.length > 100) fail("scenarios must be a list of 1-100");
  const ids = new Set<string>();
  for (const scenario of scenarios) {
    if (typeof scenario.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(scenario.id) || ids.has(scenario.id)) {
      fail("scenario ids are unique lowercase names (letters, digits, hyphens)");
    }
    ids.add(scenario.id);
    for (const key of Object.keys(scenario)) if (!["id", "title", "theme", "viewport", "setup", "steps"].includes(key)) fail(`${scenario.id} has unknown field ${key}`);
    if (typeof scenario.title !== "string") fail(`${scenario.id} needs a title`);
    if (scenario.theme !== undefined) parseTheme(scenario.theme);
    if (scenario.viewport !== undefined) parseViewport(scenario.viewport);
    const setup: readonly SuiteStep[] = scenario.setup ?? [];
    setup.forEach((step, index) => checkStep(step, `${scenario.id} setup ${index}`, SETUP_COMMANDS));
    const steps: readonly SuiteStep[] = scenario.steps;
    if (!Array.isArray(steps) || steps.length === 0) fail(`${scenario.id} has no steps`);
    steps.forEach((step, index) => checkStep(step, `${scenario.id} step ${index}`, undefined));
    if (!steps.some(isAssertion)) fail(`${scenario.id} has no assertion`);
    // An earlier assertion cannot vouch for a later action: the last action needs its own outcome.
    const lastAction = steps.findLastIndex((step) => ACTIONS.has(step.command));
    const lastAssertion = steps.findLastIndex(isAssertion);
    if (lastAction > lastAssertion) fail(`${scenario.id} ends with an action and no assertion of its outcome`);
  }
  return suite;
}

/** Suite options are JSON; commands take CLI options (kebab-case strings). */
export function stepOptions(step: SuiteStep): Options {
  const options: Options = {};
  for (const [key, value] of Object.entries(step.options ?? {})) {
    const name = key === "timeoutMs" ? "timeout-ms" : key;
    if (value === true) options[name] = true;
    else if (value === false) continue;
    else if (typeof value === "object") options[name] = JSON.stringify(value);
    else options[name] = String(value);
  }
  return options;
}

function provenanceOf(state: RunState, browserVersion: string): Record<string, unknown> {
  return {
    run: state.runId,
    checkout: state.checkout,
    branch: state.branch,
    revision: state.revision,
    sourceDigest: state.sourceDigest,
    models: state.models,
    live: state.live,
    clockStart: state.clockStart ?? "system",
    browser: `Google Chrome ${browserVersion} (headless: ${!state.headed})`,
    dataIsolation: "the run's own backend process, data and trace directories (disposable)",
  };
}

export interface SuiteRun {
  readonly host: BrowserHost;
  readonly state: RunState;
  readonly redactor: Redactor;
  readonly doctorContext: DoctorContext;
  readonly file: string;
}

async function runScenario(run: SuiteRun, scenario: SuiteScenario, result: ScenarioResult): Promise<void> {
  const began = Date.now();
  let session: BrowserSession | undefined;
  let phase: "setup" | "step" = "setup";
  const all = [...(scenario.setup ?? []).map((step) => ({ step, phase: "setup" as const })), ...scenario.steps.map((step) => ({ step, phase: "step" as const }))];
  result.steps = all.map(({ step, phase: stepPhase }, index) => ({
    index,
    phase: stepPhase,
    command: step.command,
    ...(step.note === undefined ? {} : { note: step.note }),
    status: "NOT RUN",
    screenshots: [],
  }));
  try {
    try {
      session = await run.host.newSession({ evidence: result.evidence, theme: result.theme as "dark", viewport: result.viewport });
    } catch (error) {
      throw new CommandFailure(`Could not open a fresh browser context: ${error instanceof Error ? error.message : String(error)}`, { blocked: true });
    }
    const doctor = await session.doctor(run.doctorContext);
    writePrivateJson(path.join(result.evidence, "doctor.json"), doctor);
    if (!doctor.ok) throw new CommandFailure(`Scenario doctor failed: ${JSON.stringify(doctor.checks)}`, { blocked: true });
    for (const [index, { step, phase: stepPhase }] of all.entries()) {
      phase = stepPhase;
      const record = result.steps[index];
      if (record === undefined) continue;
      const started = Date.now();
      try {
        if (ACTIONS.has(step.command) && step.command !== "goto") {
          const name = `step-${index}-action.png`;
          await session.screenshot(name, { fullPage: false });
          record.screenshots.push(name);
        }
        await session.command([step.command, ...(step.args ?? [])], stepOptions(step));
        if (isAssertion(step) || step.command === "screenshot") {
          const name = `step-${index}-outcome.png`;
          await session.screenshot(name, { fullPage: false });
          record.screenshots.push(name);
        }
        record.status = "PASS";
      } catch (error) {
        const blocked = stepPhase === "setup" || (error instanceof CommandFailure && error.blocked);
        record.status = blocked ? "BLOCKED" : "FAIL";
        record.error = run.redactor.redact(error instanceof Error ? error.message : String(error));
        throw new CommandFailure(record.error, { blocked });
      } finally {
        record.durationMs = Date.now() - started;
      }
    }
    const blockedRequests = await session.blockedFindings();
    if (blockedRequests.length > 0) {
      result.blockedRequests = blockedRequests;
      throw new CommandFailure(`The network guard blocked ${blockedRequests.length} request(s) to hosts outside the run`);
    }
    result.status = "PASS";
  } catch (error) {
    const blocked = error instanceof CommandFailure ? error.blocked : phase === "setup";
    result.status = blocked ? "BLOCKED" : "FAIL";
    result.error = run.redactor.redact(error instanceof Error ? error.message : String(error));
    if (session !== undefined) {
      try {
        await session.screenshot("failure.png", { fullPage: false });
        result.failureScreenshot = "failure.png";
      } catch {
        // The context may be gone; the error says why.
      }
    }
  } finally {
    if (session !== undefined) {
      try {
        await session.close();
        result.contextClosed = true;
      } catch {
        result.contextClosed = false;
        if (result.status === "PASS") {
          result.status = "FAIL";
          result.error = "The scenario's browser context did not close";
        }
      }
    }
    result.durationMs = Date.now() - began;
    writePrivateJson(path.join(result.evidence, "result.json"), result);
  }
}

export async function runSuite(run: SuiteRun, { html }: { html: boolean }): Promise<SuiteReport> {
  if (fs.statSync(run.file).size > 1024 * 1024) throw new Error("Suite files are at most 1 MiB");
  const manifest = fs.readFileSync(run.file, "utf8");
  const suite = validateSuite(JSON.parse(manifest));
  const started = Date.now();
  const directory = path.join(run.state.evidence, `suite-${suite.feature.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}-${started}-${crypto.randomBytes(2).toString("hex")}`);
  ensurePrivateDir(directory);
  const report: SuiteReport = {
    version: 1,
    title: suite.title,
    feature: suite.feature,
    ...(suite.description === undefined ? {} : { description: suite.description }),
    manifest: run.file,
    manifestDigest: crypto.createHash("sha256").update(manifest).digest("hex"),
    startedAt: new Date(started).toISOString(),
    provenance: provenanceOf(run.state, run.host.version),
    scenarios: suite.scenarios.map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      status: "NOT RUN",
      theme: scenario.theme ?? run.state.theme,
      viewport: scenario.viewport ?? "desktop",
      evidence: path.join(directory, scenario.id),
      steps: [],
    })),
    counts: { PASS: 0, FAIL: 0, BLOCKED: 0, "NOT RUN": 0 },
    status: "NOT RUN",
    ok: false,
    report: path.join(directory, "report.json"),
  };
  for (const [index, scenario] of suite.scenarios.entries()) {
    const result = report.scenarios[index];
    if (result === undefined) continue;
    ensurePrivateDir(result.evidence);
    await runScenario(run, scenario, result);
  }
  for (const status of ["PASS", "FAIL", "BLOCKED", "NOT RUN"] as const) report.counts[status] = report.scenarios.filter((scenario) => scenario.status === status).length;
  report.status = report.counts.FAIL > 0 ? "FAIL" : report.counts.BLOCKED > 0 ? "BLOCKED" : report.counts["NOT RUN"] > 0 ? "NOT RUN" : "PASS";
  report.ok = report.status === "PASS";
  report.durationMs = Date.now() - started;
  writePrivateJson(report.report, report);
  if (html) {
    try {
      report.html = writeHtmlReport(report);
    } catch (error) {
      report.htmlError = `HTML report not written: ${error instanceof Error ? error.message : String(error)}`;
    }
    writePrivateJson(report.report, report);
  }
  return report;
}
