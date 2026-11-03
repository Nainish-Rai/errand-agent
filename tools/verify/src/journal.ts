import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { EVIDENCE_ROOT, ensurePrivateDir, isRunId, runPaths, writePrivateJson } from "./run-paths";

// The `commands/` journal: one start and one end file per command, so `history` lists every
// outcome, failures included, after cleanup too. It records the command name, status, timing and
// error, never the arguments or entered values.

export type CommandStatus = "RUNNING" | "PASS" | "FAIL" | "BLOCKED";

export interface JournalEntry {
  readonly version: 1;
  readonly id: string;
  readonly run: string;
  readonly command: string;
  status: CommandStatus;
  readonly startedAt: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
  report?: string;
  html?: string;
  screenshot?: string;
  readonly source: { readonly revision: string; readonly sourceDigest: string };
}

export interface ResultLike {
  readonly ok?: unknown;
  readonly status?: unknown;
  readonly error?: unknown;
  readonly report?: unknown;
  readonly html?: unknown;
  readonly screenshot?: unknown;
}

const KNOWN_COMMANDS = new Set([
  "doctor", "goto", "reload", "click", "hover", "fill", "type", "key", "wait", "text", "count", "assert", "locate",
  "viewport", "theme", "motion", "screenshot", "snapshot", "network", "logs", "api", "suite", "cleanup",
]);

function statusOf(result: ResultLike): CommandStatus {
  if (result.status === "PASS" || result.status === "FAIL" || result.status === "BLOCKED") return result.status;
  return result.ok === false ? "FAIL" : "PASS";
}

export function beginCommand(
  directory: string,
  run: string,
  source: JournalEntry["source"],
  word: string | undefined,
): { finish: (result: ResultLike) => JournalEntry } {
  ensurePrivateDir(directory);
  const id = `${Date.now()}-${crypto.randomUUID()}`;
  const entry: JournalEntry = {
    version: 1,
    id,
    run,
    command: word !== undefined && KNOWN_COMMANDS.has(word) ? word : "unknown",
    status: "RUNNING",
    startedAt: new Date().toISOString(),
    source,
  };
  writePrivateJson(path.join(directory, `${id}-start.json`), entry);
  const began = performance.now();
  return {
    finish(result) {
      const end: JournalEntry = { ...entry, status: statusOf(result), completedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - began) };
      if (typeof result.error === "string") end.error = result.error.slice(0, 2000);
      for (const key of ["report", "html", "screenshot"] as const) {
        const value = result[key];
        if (typeof value === "string") end[key] = value;
      }
      writePrivateJson(path.join(directory, `${id}-end.json`), end);
      return end;
    },
  };
}

export function readHistory({ run, limit = 50 }: { run?: string; limit?: number }): { ok: true; total: number; entries: JournalEntry[] } {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("--limit is 1-1000");
  const runs = run !== undefined ? [run] : fs.existsSync(EVIDENCE_ROOT) ? fs.readdirSync(EVIDENCE_ROOT).filter(isRunId) : [];
  const entries = new Map<string, JournalEntry>();
  for (const id of runs) {
    const directory = runPaths(id).commands;
    if (!fs.existsSync(directory)) continue;
    for (const name of fs.readdirSync(directory).filter((file) => /-(start|end)\.json$/.test(file)).sort()) {
      const row = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")) as JournalEntry;
      if (!entries.has(row.id) || name.endsWith("-end.json")) entries.set(row.id, row);
    }
  }
  const sorted = [...entries.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
  return { ok: true, total: sorted.length, entries: sorted.slice(0, limit) };
}
