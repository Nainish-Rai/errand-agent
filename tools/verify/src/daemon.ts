import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import { BrowserHost, CommandFailure, type BrowserSession, type CommandResult } from "./browser-session";
import type { Options } from "./cli-arguments";
import { beginCommand } from "./journal";
import { Redactor } from "./redaction";
import { readJson, runPaths, writePrivateJson } from "./run-paths";
import { ownedProcessIds, startRuntime, stopOwnedProcesses, type LaunchOptions, type Runtime } from "./runtime";
import { runSuite } from "./suite";

// One daemon per run. It owns the servers, the Chrome host and the root page, so separate CLI
// invocations drive the same page. It answers one JSON request per connection on the run's unix
// socket, one command at a time.

export interface DaemonRequest {
  readonly words: string[];
  readonly options: Options;
}

export interface CleanupResult {
  readonly ok: boolean;
  readonly evidence: string;
  readonly daemonPid: number;
  readonly processesStopped: number[];
  readonly processesRemaining: number[];
  readonly browserProcessesRemaining: number[];
  readonly portsListening: number[];
  readonly snapshotRemoved: boolean;
}

export async function serve(runId: string): Promise<void> {
  const paths = runPaths(runId);
  const launch = readJson<LaunchOptions>(paths.launchConfig);
  const redactor = new Redactor();
  let runtime: Runtime | undefined;
  let host: BrowserHost | undefined;
  let root: BrowserSession | undefined;
  let server: net.Server | undefined;
  let cleaning: Promise<CleanupResult> | undefined;

  const cleanup = (): Promise<CleanupResult> => {
    cleaning ??= (async () => {
      // Chrome and its helpers are this daemon's descendants; note them before closing the browser.
      const browserTree = ownedProcessIds([process.pid]).filter((pid) => pid !== process.pid);
      const runtimeRoots = new Set(runtime?.state.processes.map((owned) => owned.pid) ?? []);
      const browserProcesses = browserTree.filter((pid) => !runtimeRoots.has(pid) && !ownedProcessIds([...runtimeRoots]).includes(pid));
      try {
        await host?.close();
      } catch {
        // Stopped below by PID if it did not close.
      }
      const browserLeft = (await stopOwnedProcesses({ roots: browserProcesses.filter(isAlive) })).remaining;
      const report = runtime === undefined ? undefined : await runtime.cleanup();
      server?.close();
      fs.rmSync(paths.socket, { force: true });
      const result: CleanupResult = {
        ok: report !== undefined && report.processesRemaining.length === 0 && report.portsListening.length === 0 && report.snapshotRemoved && browserLeft.length === 0,
        evidence: paths.evidence,
        daemonPid: process.pid,
        processesStopped: [...(report?.processesStopped ?? []), ...browserProcesses].sort((a, b) => a - b),
        processesRemaining: report?.processesRemaining ?? [],
        browserProcessesRemaining: browserLeft,
        portsListening: report?.portsListening ?? [],
        snapshotRemoved: report?.snapshotRemoved ?? !fs.existsSync(paths.snapshot),
      };
      if (runtime !== undefined) {
        runtime.state.cleanup = { ...runtime.state.cleanup!, ...result };
        runtime.save();
      }
      return result;
    })();
    return cleaning;
  };

  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.on(signal, () => {
      void cleanup().finally(() => process.exit(0));
    });
  }

  try {
    runtime = await startRuntime(launch, paths, redactor);
    const started = Date.now();
    host = await BrowserHost.launch(runtime.state, redactor);
    root = await host.newSession({ evidence: paths.evidence, theme: launch.theme });
    await root.goto("/");
    runtime.state.browser = { channel: "chrome", version: host.version, headless: !launch.headed };
    runtime.state.timings.browserReadyMs = Date.now() - started;
    runtime.save();
  } catch (error) {
    writePrivateJson(paths.launchError, { error: redactor.redact(error instanceof Error ? error.message : String(error)), evidence: paths.evidence });
    await cleanup().catch(() => undefined);
    if (runtime !== undefined) {
      runtime.state.status = "launch-failed";
      runtime.save();
    }
    setTimeout(() => process.exit(1), 100);
    return;
  }

  const activeRuntime = runtime;
  const activeHost = host;
  const page = root;
  const doctorContext = { childrenAlive: activeRuntime.childrenAlive };
  const source = { revision: activeRuntime.state.revision, sourceDigest: activeRuntime.state.sourceDigest };
  let busy = false;

  async function handle(request: DaemonRequest): Promise<CommandResult> {
    const word = request.words[0];
    if (word === "doctor") return await page.doctor(doctorContext);
    if (word === "suite") {
      const file = request.words[1];
      if (file === undefined || request.words.length !== 2) throw new Error("Use suite FILE.json [--report html]");
      return {
        ...(await runSuite({ host: activeHost, state: activeRuntime.state, redactor, doctorContext, file }, { html: request.options.report === "html" })),
      };
    }
    return await page.command(request.words, request.options);
  }

  server = net.createServer({ allowHalfOpen: true }, (socket) => {
    let data = "";
    socket.on("error", () => undefined);
    socket.on("data", (chunk) => {
      data += chunk.toString("utf8");
      if (data.length > 2e6) socket.destroy();
    });
    socket.on("end", () => {
      void (async () => {
        let request: DaemonRequest;
        try {
          request = JSON.parse(data) as DaemonRequest;
        } catch {
          socket.end(JSON.stringify({ ok: false, error: "Malformed request" }));
          return;
        }
        const journal = beginCommand(paths.commands, runId, source, request.words[0]);
        if (busy) {
          const rejection = { ok: false, status: "BLOCKED", error: "Another command is driving this run; wait, or use another run ID" };
          journal.finish(rejection);
          socket.end(JSON.stringify(rejection));
          return;
        }
        busy = true;
        try {
          if (request.words[0] === "cleanup") {
            const result = await cleanup();
            journal.finish(result);
            socket.end(JSON.stringify(result));
            setTimeout(() => process.exit(0), 200);
            return;
          }
          const result = await handle(request);
          journal.finish(result);
          socket.end(redactor.redact(JSON.stringify(result)));
        } catch (error) {
          const message = redactor.redact(error instanceof Error ? error.message : String(error));
          const status = error instanceof CommandFailure && error.blocked ? "BLOCKED" : "FAIL";
          const failure: Record<string, unknown> = { ok: false, status, command: request.words[0], error: message, time: new Date().toISOString() };
          try {
            failure.screenshot = (await page.screenshot(`failure-${Date.now()}.png`, { fullPage: false })).file;
          } catch {
            failure.screenshot = null;
          }
          failure.failure = path.join(paths.evidence, "command-failure.json");
          writePrivateJson(path.join(paths.evidence, "command-failure.json"), failure);
          journal.finish(failure);
          socket.end(JSON.stringify(failure));
        } finally {
          busy = false;
        }
      })();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server?.once("error", reject);
    server?.listen(paths.socket, () => resolve());
  });
  fs.chmodSync(paths.socket, 0o600);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
