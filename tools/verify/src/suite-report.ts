// The result of a suite run: report.json, and the input to the HTML report.

export type ScenarioStatus = "PASS" | "FAIL" | "BLOCKED" | "NOT RUN";

export interface StepResult {
  index: number;
  phase: "setup" | "step";
  command: string;
  note?: string;
  status: ScenarioStatus;
  durationMs?: number;
  screenshots: string[];
  error?: string;
}

export interface ScenarioResult {
  id: string;
  title: string;
  status: ScenarioStatus;
  theme: string;
  viewport: string;
  evidence: string;
  steps: StepResult[];
  error?: string;
  failureScreenshot?: string;
  blockedRequests?: unknown[];
  contextClosed?: boolean;
  durationMs?: number;
}

export interface SuiteReport {
  version: 1;
  title: string;
  feature: string;
  description?: string;
  manifest: string;
  manifestDigest: string;
  startedAt: string;
  durationMs?: number;
  provenance: Record<string, unknown>;
  scenarios: ScenarioResult[];
  counts: Record<ScenarioStatus, number>;
  status: ScenarioStatus;
  ok: boolean;
  report: string;
  html?: string;
  htmlError?: string;
}
