import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import { ApiClient } from "@errand/client";

import type { Redactor } from "./redaction";
import { ensurePrivateDir, writePrivateJson, type RunPaths } from "./run-paths";
import { NOT_SNAPSHOTTED, sourceIdentity } from "./source-identity";

// The owned copy of the app: a copy-on-write snapshot of the checkout with its own backend (eve dev)
// and web (next dev) on free ports, its own data and trace directories, and nothing shared with
// `pnpm dev`. Every process is started detached in its own process group, so cleanup can stop the
// whole tree it started and prove nothing is left.

/** The same pinned start the evals use, so "this week" and the seeded slots match on any day. */
export const DEFAULT_CLOCK_START = "2026-11-04T09:00:00+05:30";
const SCRIPTED_MODELS = "main=scripted,review_reader=scripted,user_simulator=scripted";
const LIVE_MODELS = "main=minimax,review_reader=minimax,user_simulator=scripted";
const KEYCHAIN_SERVICE = "errand-agent-minimax";
/** The ports `pnpm dev` uses; a run never takes them. */
const RESERVED_PORTS = new Set([3000, 3100]);

export interface OwnedProcess {
  readonly label: "backend" | "web";
  readonly pid: number;
  readonly ports: readonly number[];
}

export interface RunState {
  version: 1;
  runId: string;
  status: "starting" | "ready" | "cleaning" | "cleaned" | "launch-failed" | "cleanup-failed";
  checkout: string;
  branch: string | null;
  revision: string;
  sourceDigest: string;
  evidence: string;
  snapshot: string;
  dataDir: string;
  traceDir: string;
  live: boolean;
  models: string;
  clockStart: string | null;
  theme: "dark" | "light";
  headed: boolean;
  ports: { backend: number; web: number };
  urls: { backend: string; web: string };
  daemon: { pid: number };
  processes: OwnedProcess[];
  browser?: { channel: string; version: string; headless: boolean };
  timings: Record<string, number>;
  startedAt: string;
  cleanedAt?: string;
  cleanup?: CleanupReport;
  error?: string;
}

export interface LaunchOptions {
  readonly runId: string;
  readonly checkout: string;
  readonly live: boolean;
  readonly models?: string;
  readonly clock?: string;
  readonly theme: "dark" | "light";
  readonly headed: boolean;
  readonly backendPort?: number;
  readonly webPort?: number;
  readonly readyTimeoutMs: number;
}

export interface CleanupReport {
  readonly processesStopped: number;
  readonly processesRemaining: number[];
  readonly portsListening: number[];
  readonly snapshotRemoved: boolean;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function freePort(taken: ReadonlySet<number> = new Set()): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const port = typeof address === "object" && address !== null ? address.port : 0;
    if (port > 0 && !RESERVED_PORTS.has(port) && !taken.has(port)) return port;
  }
  throw new Error("No free localhost port found");
}

/**
 * APFS copy-on-write clone (`cp -c -R`) of the whole checkout, node_modules and uncommitted edits
 * included, so later edits never change a running verification. Git internals, runtime data, build
 * caches and env files are never copied.
 */
export function snapshotCheckout(source: string, destination: string): void {
  ensurePrivateDir(destination);
  for (const name of fs.readdirSync(source)) {
    if (NOT_SNAPSHOTTED.test(name)) continue;
    const from = path.join(source, name);
    const to = path.join(destination, name);
    const clone = process.platform === "darwin" ? spawnSync("cp", ["-c", "-R", from, to], { stdio: "pipe" }) : { status: 1 };
    if (clone.status !== 0) fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
  }
  // Nested build caches and env files: the web app's .next, and any env file in a workspace package.
  fs.rmSync(path.join(destination, "apps/web/.next"), { recursive: true, force: true });
  for (const parent of ["apps", "packages", "tools"]) {
    const directory = path.join(destination, parent);
    if (!fs.existsSync(directory)) continue;
    for (const workspace of fs.readdirSync(directory)) {
      const root = path.join(directory, workspace);
      if (!fs.statSync(root).isDirectory()) continue;
      for (const file of fs.readdirSync(root)) if (file.startsWith(".env")) fs.rmSync(path.join(root, file), { force: true });
    }
  }
}

/** The MiniMax key for `--live`, read from the Keychain at launch and held only in the backend's environment. */
function minimaxKey(): string {
  try {
    const key = execFileSync("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (key !== "") return key;
  } catch {
    // Fall through to the process environment.
  }
  const fromEnvironment = process.env.MINIMAX_API_KEY?.trim();
  if (fromEnvironment) return fromEnvironment;
  throw new Error(`--live needs the MiniMax key: store it once with security add-generic-password -s ${KEYCHAIN_SERVICE} -a "$USER" -w`);
}

/** The environment the run's servers inherit: no keys unless live, and the run's own directories. */
function serverEnvironment(state: RunState, key: string | undefined): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (name.startsWith("ERRAND_") || name.startsWith("NEXT_PUBLIC_") || ["MINIMAX_API_KEY", "ANTHROPIC_API_KEY", "PORT", "NODE_OPTIONS"].includes(name)) {
      delete environment[name];
    }
  }
  Object.assign(environment, {
    NODE_ENV: "development",
    ERRAND_MODELS: state.models,
    ERRAND_TRACE_DIR: state.traceDir,
    ERRAND_DATA_DIR: state.dataDir,
    NEXT_TELEMETRY_DISABLED: "1",
    EVE_TELEMETRY_DISABLED: "1",
    DO_NOT_TRACK: "1",
  });
  if (state.clockStart !== null) environment.ERRAND_CLOCK_START = state.clockStart;
  if (key !== undefined) environment.MINIMAX_API_KEY = key;
  return environment;
}

function processGroupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
  readonly command: string;
}

function processTable(): ProcessRow[] {
  const output = execFileSync("ps", ["-Ao", "pid=,ppid=,pgid=,command="], { encoding: "utf8", maxBuffer: 50e6 });
  return output.split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), command: match[4] ?? "" }] : [];
  });
}

/** Every live process this run started: the owned process groups plus any descendant that left them. */
export function ownedProcessIds(roots: readonly number[]): number[] {
  const table = processTable();
  const owned = new Set<number>();
  for (const row of table) if (roots.includes(row.pgid) || roots.includes(row.pid)) owned.add(row.pid);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of table) {
      if (!owned.has(row.pid) && owned.has(row.ppid)) {
        owned.add(row.pid);
        grew = true;
      }
    }
  }
  return [...owned].sort((a, b) => a - b);
}

/** PIDs listening on a TCP port (empty when nothing listens). */
export function listenersOn(port: number): number[] {
  try {
    return execFileSync("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number);
  } catch {
    return [];
  }
}

export interface Runtime {
  readonly state: RunState;
  readonly save: () => void;
  readonly childrenAlive: () => boolean;
  readonly cleanup: () => Promise<CleanupReport>;
}

/** Stops every owned process tree: SIGTERM to each group and its descendants, then SIGKILL what is left. */
export async function stopOwnedProcesses(roots: readonly number[]): Promise<{ stopped: number; remaining: number[] }> {
  const initial = ownedProcessIds(roots);
  const signal = (pids: readonly number[], name: NodeJS.Signals) => {
    for (const root of roots) {
      try {
        process.kill(-root, name);
      } catch {
        // Group already gone.
      }
    }
    for (const pid of pids) {
      try {
        process.kill(pid, name);
      } catch {
        // Already exited.
      }
    }
  };
  signal(initial, "SIGTERM");
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && ownedProcessIds(roots).length > 0) await delay(250);
  const survivors = ownedProcessIds(roots);
  if (survivors.length > 0) {
    signal(survivors, "SIGKILL");
    await delay(500);
  }
  return { stopped: initial.length, remaining: ownedProcessIds(roots) };
}

export async function startRuntime(options: LaunchOptions, paths: RunPaths, redactor: Redactor): Promise<Runtime> {
  const identity = sourceIdentity(options.checkout);
  const backendPort = options.backendPort ?? (await freePort());
  const webPort = options.webPort ?? (await freePort(new Set([backendPort])));
  const clockStart = options.clock === "system" ? null : (options.clock ?? DEFAULT_CLOCK_START);
  const state: RunState = {
    version: 1,
    runId: options.runId,
    status: "starting",
    ...identity,
    evidence: paths.evidence,
    snapshot: paths.snapshot,
    dataDir: paths.data,
    traceDir: paths.traces,
    live: options.live,
    models: options.models ?? (options.live ? LIVE_MODELS : SCRIPTED_MODELS),
    clockStart,
    theme: options.theme,
    headed: options.headed,
    ports: { backend: backendPort, web: webPort },
    urls: { backend: `http://127.0.0.1:${backendPort}`, web: `http://127.0.0.1:${webPort}` },
    daemon: { pid: process.pid },
    processes: [],
    timings: {},
    startedAt: new Date().toISOString(),
  };
  const children: ChildProcess[] = [];
  const save = () => writePrivateJson(paths.state, state);

  function start(label: OwnedProcess["label"], command: string, args: string[], cwd: string, environment: NodeJS.ProcessEnv, ports: number[]) {
    const logFile = path.join(paths.evidence, `${label}.log`);
    fs.writeFileSync(logFile, "", { mode: 0o600, flag: "a" });
    const child = spawn(command, args, { cwd, env: environment, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let pending = "";
    const write = (chunk: Buffer) => {
      pending += chunk.toString("utf8");
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      if (lines.length > 0) fs.appendFileSync(logFile, `${lines.map((line) => redactor.redact(line)).join("\n")}\n`);
    };
    child.stdout?.on("data", write);
    child.stderr?.on("data", write);
    child.on("exit", (code, signal) => {
      if (pending) fs.appendFileSync(logFile, `${redactor.redact(pending)}\n`);
      fs.appendFileSync(logFile, `[control-errand] ${label} exited (code ${code ?? "none"}, signal ${signal ?? "none"})\n`);
    });
    child.on("error", (error) => fs.appendFileSync(logFile, `[control-errand] ${label} failed to start: ${error.message}\n`));
    if (child.pid === undefined) throw new Error(`${label} did not start`);
    children.push(child);
    state.processes.push({ label, pid: child.pid, ports });
    save();
    return child;
  }

  const childrenAlive = () => children.length === 2 && children.every((child) => child.exitCode === null && child.signalCode === null);

  async function cleanup(): Promise<CleanupReport> {
    state.status = "cleaning";
    save();
    const { stopped, remaining } = await stopOwnedProcesses(state.processes.map((owned) => owned.pid));
    const portsListening = [state.ports.backend, state.ports.web].filter((port) => listenersOn(port).length > 0);
    fs.rmSync(paths.snapshot, { recursive: true, force: true });
    const report: CleanupReport = { processesStopped: stopped, processesRemaining: remaining, portsListening, snapshotRemoved: !fs.existsSync(paths.snapshot) };
    state.cleanup = report;
    state.status = remaining.length === 0 && portsListening.length === 0 && report.snapshotRemoved ? "cleaned" : "cleanup-failed";
    state.cleanedAt = new Date().toISOString();
    save();
    return report;
  }

  async function waitUntil(label: string, child: ChildProcess, probe: () => Promise<boolean>, deadline: number) {
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`The ${label} exited before it was ready; see ${label}.log in ${paths.evidence}`);
      if (await probe().catch(() => false)) return;
      await delay(500);
    }
    throw new Error(`The ${label} was not ready within ${Math.round(options.readyTimeoutMs / 1000)} s; see ${label}.log in ${paths.evidence}`);
  }

  save();
  try {
    const key = options.live ? minimaxKey() : undefined;
    redactor.addSecret(key);
    const started = Date.now();
    snapshotCheckout(options.checkout, paths.snapshot);
    state.timings.snapshotMs = Date.now() - started;
    ensurePrivateDir(paths.data);
    ensurePrivateDir(paths.traces);
    save();

    const environment = serverEnvironment(state, key);
    const backend = start("backend", path.join(paths.snapshot, "node_modules/.bin/eve"), ["dev", "--no-ui", "--host", "127.0.0.1", "--port", String(backendPort)], paths.snapshot, environment, [backendPort]);
    const web = start(
      "web",
      path.join(paths.snapshot, "apps/web/node_modules/.bin/next"),
      ["dev", "--hostname", "127.0.0.1", "--port", String(webPort)],
      path.join(paths.snapshot, "apps/web"),
      { ...serverEnvironment(state, undefined), NEXT_PUBLIC_BACKEND_URL: state.urls.backend },
      [webPort],
    );

    const deadline = Date.now() + options.readyTimeoutMs;
    const api = new ApiClient({ baseUrl: state.urls.backend });
    await waitUntil("backend", backend, async () => Array.isArray(await api.getProviders(["doctor-probe"])), deadline);
    state.timings.backendReadyMs = Date.now() - started;
    // The first request compiles a route; warm the routes the seed suites open.
    await waitUntil("web", web, async () => (await fetch(state.urls.web, { signal: AbortSignal.timeout(60_000) })).ok, deadline);
    await fetch(`${state.urls.web}/design`, { signal: AbortSignal.timeout(60_000) }).catch(() => undefined);
    state.timings.webReadyMs = Date.now() - started;
    state.status = "ready";
    save();
    return { state, save, childrenAlive, cleanup };
  } catch (error) {
    state.error = redactor.redact(error instanceof Error ? error.message : String(error));
    await cleanup().catch(() => undefined);
    state.status = "launch-failed";
    save();
    throw error;
  }
}
