import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Every run keeps its state and evidence in one private directory that survives cleanup:
// ~/.local/share/errand-verify/<run-id>/ (directories 700, files 600).

export const EVIDENCE_ROOT = path.resolve(process.env.ERRAND_VERIFY_HOME ?? path.join(os.homedir(), ".local/share/errand-verify"));

const RUN_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

export interface RunPaths {
  readonly id: string;
  readonly evidence: string;
  readonly state: string;
  readonly launchConfig: string;
  readonly launchError: string;
  /** The daemon's control socket. Short enough for the 104-byte macOS limit. */
  readonly socket: string;
  /** Copy-on-write clone of the checkout; removed by cleanup. */
  readonly snapshot: string;
  /** The backend's own data and trace directories, kept as evidence. */
  readonly data: string;
  readonly traces: string;
  readonly commands: string;
}

export function isRunId(id: unknown): id is string {
  return typeof id === "string" && RUN_ID.test(id);
}

export function runPaths(id: string): RunPaths {
  if (!isRunId(id)) throw new Error("Run ID must be 1-40 lowercase letters, digits or hyphens");
  const evidence = path.join(EVIDENCE_ROOT, id);
  return {
    id,
    evidence,
    state: path.join(evidence, "state.json"),
    launchConfig: path.join(evidence, "launch.json"),
    launchError: path.join(evidence, "launch-error.json"),
    socket: path.join(evidence, "control.sock"),
    snapshot: path.join(evidence, "snapshot"),
    data: path.join(evidence, "data"),
    traces: path.join(evidence, "traces"),
    commands: path.join(evidence, "commands"),
  };
}

export function ensurePrivateDir(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
}

export function writePrivateJson(file: string, value: unknown): void {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

export function appendPrivateLine(file: string, line: string): void {
  fs.appendFileSync(file, line.endsWith("\n") ? line : `${line}\n`, { mode: 0o600 });
}

export function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

/** An evidence file name: a basename inside the given directory, never a path that escapes it. */
export function evidenceFile(directory: string, name: string): string {
  if (!name || path.basename(name) !== name || name === "." || name === "..") {
    throw new Error("Evidence names must be plain file names inside the run's evidence directory");
  }
  return path.join(directory, name);
}
