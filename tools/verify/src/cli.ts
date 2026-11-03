import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { integerOption, parseArguments, stringOption, type Options } from "./cli-arguments";
import { parseTheme } from "./browser-session";
import { readHistory } from "./journal";
import { EVIDENCE_ROOT, ensurePrivateDir, readJson, runPaths, writePrivateJson, type RunPaths } from "./run-paths";
import { listenersOn, ownedProcesses, stopOwnedProcesses, type LaunchOptions, type RunState } from "./runtime";
import { resolveCheckout, sourceIdentity, validateCheckout } from "./source-identity";

const BIN = fileURLToPath(new URL("../bin/control-errand.js", import.meta.url));

const HELP = `control-errand [--repo /path/to/errand-agent] --run <run-id> <command> [options]

Isolated browser verification of the errand agent. Each run is a copy-on-write snapshot of the
checkout with its own backend (eve) and web (Next) on free ports, its own data and trace
directories, and its own network-guarded headless Chrome, all owned by one daemon.

Run lifecycle
  launch [--live] [--models SETTING] [--clock ISO|system] [--theme dark|light] [--headed]
         [--backend-port N] [--web-port N] [--ready-timeout SECONDS]
      Snapshot the checkout (uncommitted edits included) and start everything. Models are scripted
      by default (no key, no network). --live uses MiniMax for the main model, reading the key from
      the Keychain (service errand-agent-minimax) at launch only. The clock is pinned to
      2026-11-04T09:00:00+05:30 like the evals unless --clock says otherwise.
  doctor           Owned processes and ports, unchanged snapshot, backend /api/v1, web, browser,
                   networkGuard (a probe to a public host must appear as blocked in \`network\`).
  status           The run's state.json, after cleanup too.
  cleanup          Stop the daemon, servers and Chrome; remove the snapshot; keep evidence. Reports
                   daemonExited, processesRemaining and portsListening.

Driving (the root page; targets: SELECTOR, or --role ROLE --name NAME | --label L | --testid ID | --text T, [--nth N])
  goto /ROUTE · reload · click TARGET [--clicks 2] · hover TARGET · fill TARGET --value TEXT
  type TEXT (into the focused element) · key Enter|Escape|ControlOrMeta+A
  wait TARGET [--state visible|hidden|attached|detached] [--timeout-ms MS]
  text TARGET · count TARGET
  assert TARGET (--text T | --value V | --count N | --attr name=value | --style property=value | --state hidden|visible|attached|detached)
  assert --url /ROUTE
      Assertions retry until --timeout-ms (default 15000). In assert, --text is the expected text.
  locate TARGET [--operation click|hover|fill]
      Match count, uniqueness and actionability without acting, plus a ready suite step.
  viewport desktop|laptop|tablet|phone|WIDTHxHEIGHT · theme dark|light (the system color scheme)
  motion reduce|no-preference (the system's prefers-reduced-motion)

Evidence
  screenshot [NAME.png] [--viewport] [--animations allow] · snapshot [NAME.txt] [target options] (ARIA tree)
      Screenshots settle animations; --animations allow captures the frame as it is, mid-motion.
  network [--method M] [--path /exact | /prefix*] [--status N] [--since ISO]
  logs [--level error] [--since ISO]                      console messages and page errors
  api GET|POST|PUT|PATCH|DELETE /api/v1/... [--body JSON] [--expect JSON] [--timeout-ms MS]
      Through packages/client, so bodies are parsed against the contracts. sessions/current/... is
      the page's chat session. --expect: {"path":"spans[*].name","includes":"..."} (or a list;
      equals, includes, atLeast, length); GET expectations retry, writes are sent once.
      [--as person|operator|other-person] calls as the dev person (default), the run's operator (the
      only caller the trace, context and /ops routes answer) or a second signed-in person.
      [--status N] expects that HTTP status instead, e.g. 404 for a refused session.
  fill --value "{{operator-token}}" types the run's operator token (it never appears in a log).

Suites and history
  suite FILE.json [--report html]   Fresh browser context per scenario; PASS, FAIL or BLOCKED each.
  history [--run ID] [--limit 50]   Command outcomes, failures included, after cleanup too.
  fingerprint                       Checkout, branch, revision and source digest; no run needed.

Evidence: ${EVIDENCE_ROOT}/<run-id>/ (private; survives cleanup).
A failed command writes command-failure.json and a failure screenshot there.
Checkout: --repo, then ERRAND_REPO, then the Git root of the working directory.
`;

const LONG_COMMANDS = new Set(["suite"]);

function request(paths: RunPaths, payload: { words: string[]; options: Options }): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(paths.socket);
    let data = "";
    socket.setTimeout(LONG_COMMANDS.has(payload.words[0] ?? "") ? 3_600_000 : 900_000, () =>
      socket.destroy(new Error("The daemon did not answer in time; inspect the run before retrying any write")),
    );
    socket.on("error", (error: NodeJS.ErrnoException) =>
      reject(error.code === "ENOENT" || error.code === "ECONNREFUSED" ? new Error(`No daemon for run ${paths.id}: launch it first (or it was cleaned up)`) : error),
    );
    socket.on("connect", () => socket.end(`${JSON.stringify(payload)}\n`));
    socket.on("data", (chunk) => {
      data += chunk.toString("utf8");
    });
    socket.on("end", () => {
      try {
        resolve(JSON.parse(data) as Record<string, unknown>);
      } catch {
        reject(new Error("The daemon returned no valid answer; see daemon.log"));
      }
    });
  });
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isAlive(pid: number | undefined): boolean {
  if (pid === undefined || !Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await delay(200);
  }
  return !isAlive(pid);
}

/** True only for this run's own daemon: its command line names this bin, this run and `_serve`. */
function isOwnDaemon(pid: number | undefined, runId: string): boolean {
  if (!isAlive(pid)) return false;
  try {
    const command = execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }).trim();
    return command.includes(BIN) && command.includes(`--run ${runId} _serve`);
  } catch {
    return false;
  }
}

function print(result: unknown): void {
  console.log(JSON.stringify(result, null, 2));
  if (result !== null && typeof result === "object" && (result as { ok?: unknown }).ok === false) process.exitCode = 1;
}

async function launch(paths: RunPaths, options: Options): Promise<void> {
  const checkout = resolveCheckout(stringOption(options, "repo"));
  validateCheckout(checkout);
  const theme = parseTheme(stringOption(options, "theme"));
  const backendPort = integerOption(options, "backend-port", 1024, 65_535);
  const webPort = integerOption(options, "web-port", 1024, 65_535);
  for (const port of [backendPort, webPort]) {
    if (port === undefined) continue;
    if (port === 3000 || port === 3100) throw new Error("Ports 3000 and 3100 belong to pnpm dev; pick another or let the run choose");
    if (listenersOn(port).length > 0) throw new Error(`Port ${port} is already in use`);
  }
  const config: LaunchOptions = {
    runId: paths.id,
    checkout,
    live: options.live === true,
    ...(stringOption(options, "models") === undefined ? {} : { models: stringOption(options, "models") }),
    ...(stringOption(options, "clock") === undefined ? {} : { clock: stringOption(options, "clock") }),
    theme,
    headed: options.headed === true,
    ...(backendPort === undefined ? {} : { backendPort }),
    ...(webPort === undefined ? {} : { webPort }),
    readyTimeoutMs: (integerOption(options, "ready-timeout", 10, 1800) ?? 240) * 1000,
  };
  ensurePrivateDir(EVIDENCE_ROOT);
  // mkdir is the claim: a run ID is used once, so evidence is never overwritten or shared.
  try {
    fs.mkdirSync(paths.evidence, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Run ${paths.id} already exists (${paths.evidence}); use a new run ID`);
    throw error;
  }
  writePrivateJson(paths.launchConfig, config);
  const log = fs.openSync(path.join(paths.evidence, "daemon.log"), "a", 0o600);
  const child = spawn(process.execPath, [BIN, "--run", paths.id, "_serve"], { cwd: checkout, detached: true, stdio: ["ignore", log, log] });
  fs.closeSync(log);
  child.unref();
  const deadline = Date.now() + config.readyTimeoutMs + 120_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(paths.launchError)) {
      const failure = readJson<{ error: string }>(paths.launchError);
      await waitForExit(child.pid ?? 0, 30_000);
      throw new Error(`Launch failed: ${failure.error}. Everything it started was stopped; evidence: ${paths.evidence}`);
    }
    if (fs.existsSync(paths.socket)) {
      const doctor = await request(paths, { words: ["doctor"], options: {} });
      const state = readJson<RunState>(paths.state);
      print({ ...doctor, launched: true, timings: state.timings, daemonPid: state.daemon.pid });
      return;
    }
    if (!isAlive(child.pid)) throw new Error(`The daemon exited during launch; see ${path.join(paths.evidence, "daemon.log")}`);
    await delay(500);
  }
  if (child.pid !== undefined) process.kill(child.pid, "SIGTERM");
  throw new Error(`Launch timed out; the daemon was asked to clean up. Evidence: ${paths.evidence}`);
}

/** The ports and owned processes a cleaned run must not leave behind, checked from outside the daemon. */
function leftovers(state: RunState): { processesRemaining: number[]; portsListening: number[] } {
  return {
    processesRemaining: [
      ...new Set([
        ...ownedProcesses({ roots: state.processes.map((owned) => owned.pid), marker: state.snapshot }),
        ...(state.cleanup?.processesStopped ?? []).filter(isAlive),
      ]),
    ],
    portsListening: [state.ports.backend, state.ports.web].filter((port) => listenersOn(port).length > 0),
  };
}

async function cleanup(paths: RunPaths): Promise<void> {
  if (!fs.existsSync(paths.state)) throw new Error(`No run ${paths.id}`);
  const state = readJson<RunState>(paths.state);
  if (fs.existsSync(paths.socket)) {
    const result = await request(paths, { words: ["cleanup"], options: {} });
    const daemonPid = typeof result.daemonPid === "number" ? result.daemonPid : state.daemon.pid;
    const daemonExited = await waitForExit(daemonPid, 30_000);
    const after = leftovers(state);
    const ok = result.ok === true && daemonExited && after.processesRemaining.length === 0 && after.portsListening.length === 0;
    print({ ...result, ok, daemonExited, ...after, ports: state.ports });
    return;
  }
  if (state.status === "cleaned") {
    print({ ok: true, alreadyCleaned: true, daemonExited: !isAlive(state.daemon.pid), ...leftovers(state), evidence: paths.evidence });
    return;
  }
  // The socket is gone but the run is not cleaned. Stop only what provably belongs to this run.
  if (isOwnDaemon(state.daemon.pid, paths.id)) {
    process.kill(state.daemon.pid, "SIGTERM");
    const daemonExited = await waitForExit(state.daemon.pid, 60_000);
    const after = readJson<RunState>(paths.state);
    print({ ok: daemonExited && after.status === "cleaned", recoveredOrphanDaemon: true, daemonExited, status: after.status, ...leftovers(after), evidence: paths.evidence });
    return;
  }
  const { stopped, remaining } = await stopOwnedProcesses({ roots: state.processes.map((owned) => owned.pid), marker: state.snapshot });
  fs.rmSync(paths.snapshot, { recursive: true, force: true });
  const after = leftovers(state);
  state.status = remaining.length === 0 && after.portsListening.length === 0 ? "cleaned" : "cleanup-failed";
  state.cleanedAt = new Date().toISOString();
  writePrivateJson(paths.state, state);
  print({ ok: state.status === "cleaned", recoveredOrphanProcesses: stopped.length, daemonExited: !isAlive(state.daemon.pid), ...after, snapshotRemoved: !fs.existsSync(paths.snapshot), evidence: paths.evidence });
}

async function main(): Promise<void> {
  const { words, options } = parseArguments(process.argv.slice(2));
  const command = words[0];
  if (options.help === true || command === undefined || command === "help") {
    console.log(HELP);
    return;
  }
  const runId = stringOption(options, "run");
  if (command === "_serve") {
    const { serve } = await import("./daemon");
    await serve(runId ?? "");
    return;
  }
  if (command === "fingerprint") {
    const checkout = resolveCheckout(stringOption(options, "repo"));
    print({ ok: true, ...sourceIdentity(checkout) });
    return;
  }
  if (command === "history") {
    print(readHistory({ ...(runId === undefined ? {} : { run: runId }), limit: integerOption(options, "limit", 1, 1000) ?? 50 }));
    return;
  }
  if (runId === undefined) throw new Error("Every run command needs --run ID (a new, unique ID for launch)");
  const paths = runPaths(runId);
  if (command === "status") {
    if (!fs.existsSync(paths.state)) throw new Error(`No run ${runId}`);
    const state = readJson<RunState>(paths.state);
    print({ ok: true, ...state, daemonAlive: isAlive(state.daemon.pid) });
    return;
  }
  if (command === "launch") return await launch(paths, options);
  if (command === "cleanup") return await cleanup(paths);
  if (command === "suite" && words[1] !== undefined) words[1] = path.resolve(words[1]);
  print(await request(paths, { words, options }));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
