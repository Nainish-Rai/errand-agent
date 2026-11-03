import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

// A backend this eval owns: its own `eve dev` process (and process group) on a free port, with its
// own eve state, SQLite database and traces, so it can be killed for real and started again on the
// same files without touching the eval server or anything else on the machine. Only processes it
// started are signalled, by their process group id.

export interface BackendDirectories {
  /** eve's dev state (`EVE_DEV_STATE_DIR`): sessions, workflow runs, compiled snapshots. */
  readonly state: string;
  /** The SQLite file's directory (`ERRAND_DATA_DIR`): the ledger, proposals, the world. */
  readonly data: string;
  /** Run traces (`ERRAND_TRACE_DIR`). */
  readonly traces: string;
  /** The backend's stdout and stderr, one file per start. */
  readonly logs: string;
}

export interface BackendStart {
  readonly appRoot: string;
  readonly directories: BackendDirectories;
  readonly port: number;
  /** Extra environment for the backend: its models and pinned clock. */
  readonly environment: Readonly<Record<string, string>>;
  /** `eve dev --resume`: pick up the runs a killed process left unfinished. */
  readonly resume?: boolean;
  readonly readyWithinMs?: number;
}

export interface BackendProcess {
  readonly url: string;
  readonly pid: number;
  readonly log: string;
  /** SIGKILL to the whole process group: no shutdown hooks, nothing flushed. A crash. */
  kill(): Promise<void>;
  /** SIGTERM, then SIGKILL if it hasn't gone after a few seconds. */
  stop(): Promise<void>;
}

/**
 * The only parts of the caller's environment a backend gets. The eval runner's process carries
 * its own server's settings (eve's workflow transport secret, control URL, build output, the
 * evaluation run, workflow queue settings, ...); a second backend that inherits any of them
 * rejects its own workflow deliveries. So it starts from a clean environment, like a fresh shell.
 */
const PASSED_THROUGH = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TZ"];

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isHealthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/eve/v1/health`, { signal: AbortSignal.timeout(2_000) });
    return response.ok;
  } catch {
    return false;
  }
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(true));
  });
}

function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", () => resolve()));
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    // ESRCH: the group is already gone.
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
}

async function gone(child: ChildProcess, port: number, withinMs: number): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  await Promise.race([exited(child), sleep(withinMs)]);
  while (Date.now() < deadline) {
    if (await isPortFree(port)) return true;
    await sleep(100);
  }
  return isPortFree(port);
}

export async function startBackend(start: BackendStart): Promise<BackendProcess> {
  const { directories, port } = start;
  for (const dir of Object.values(directories)) fs.mkdirSync(dir, { recursive: true });
  const log = path.join(directories.logs, `backend-${Date.now()}.log`);
  const out = fs.openSync(log, "a");

  const environment: NodeJS.ProcessEnv = {};
  for (const name of PASSED_THROUGH) if (process.env[name] !== undefined) environment[name] = process.env[name];
  Object.assign(environment, start.environment, {
    EVE_DEV_STATE_DIR: directories.state,
    ERRAND_DATA_DIR: directories.data,
    ERRAND_TRACE_DIR: directories.traces,
    EVE_TELEMETRY_DISABLED: "1",
  });

  const args = ["dev", "--no-ui", "--host", "127.0.0.1", "--port", String(port), ...(start.resume === true ? ["--resume"] : [])];
  const child = spawn(path.join(start.appRoot, "node_modules/.bin/eve"), args, {
    cwd: start.appRoot,
    env: environment,
    // Its own process group, so a kill reaches eve's workers too and nothing else.
    detached: true,
    stdio: ["ignore", out, out],
  });
  fs.closeSync(out);
  const pid = child.pid;
  if (pid === undefined) throw new Error("The backend did not start.");

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + (start.readyWithinMs ?? 120_000);
  while (!(await isHealthy(url))) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`The backend exited while starting; see ${log}`);
    if (Date.now() > deadline) {
      signalGroup(pid, "SIGKILL");
      throw new Error(`The backend wasn't healthy in time; see ${log}`);
    }
    await sleep(250);
  }

  return {
    url,
    pid,
    log,
    async kill() {
      signalGroup(pid, "SIGKILL");
      if (!(await gone(child, port, 10_000))) throw new Error(`Backend ${pid} still holds port ${port} after SIGKILL.`);
    },
    async stop() {
      signalGroup(pid, "SIGTERM");
      if (await gone(child, port, 5_000)) return;
      signalGroup(pid, "SIGKILL");
      await gone(child, port, 5_000);
    },
  };
}
