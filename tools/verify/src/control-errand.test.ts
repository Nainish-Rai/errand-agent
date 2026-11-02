import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseArguments } from "./cli-arguments";
import { writeHtmlReport } from "./html-report";
import { cleanUrl, isAllowed, runOrigins } from "./network-guard";
import { Redactor } from "./redaction";
import { linkSkill } from "./skill-link";
import { NOT_SNAPSHOTTED } from "./source-identity";
import { stepOptions, validateSuite } from "./suite";
import type { SuiteReport } from "./suite-report";
import { parseExpectations, resolveSession, unmetExpectation, valueAt } from "./world-api";

const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), "control-errand-test-"));

describe("arguments", () => {
  it("reads words, valued options and flags, and ignores pnpm's -- separator", () => {
    const { words, options } = parseArguments(["--", "--run", "r1", "assert", "--role", "button", "--name=Send", "--live"]);
    expect(words).toEqual(["assert"]);
    expect(options).toEqual({ run: "r1", role: "button", name: "Send", live: true });
  });

  it("refuses an option with no value", () => {
    expect(() => parseArguments(["click", "--role"])).toThrow(/Missing value for --role/);
  });
});

describe("network guard", () => {
  const origins = runOrigins([51000, 51001]);

  it("allows only the run's own origins", () => {
    expect(isAllowed("http://127.0.0.1:51000/api/v1/providers?ids=a", origins)).toBe(true);
    expect(isAllowed("http://localhost:51001/_next/static/x.js", origins)).toBe(true);
    expect(isAllowed("data:image/png;base64,AAAA", origins)).toBe(true);
  });

  it("blocks public hosts, other local ports and the dev defaults", () => {
    expect(isAllowed("https://example.com/", origins)).toBe(false);
    expect(isAllowed("https://api.minimax.io/anthropic", origins)).toBe(false);
    expect(isAllowed("http://127.0.0.1:3000/", origins)).toBe(false);
    expect(isAllowed("http://127.0.0.1:3100/api/v1", origins)).toBe(false);
  });

  it("logs origin and path, never the query", () => {
    expect(cleanUrl("http://127.0.0.1:51000/api/v1/providers?ids=secret#x")).toBe("http://127.0.0.1:51000/api/v1/providers");
  });
});

describe("redaction", () => {
  it("removes registered secrets and common key shapes", () => {
    const redactor = new Redactor();
    redactor.addSecret("mm-very-secret-key-123");
    const text = redactor.redact("key mm-very-secret-key-123, Authorization: Bearer abc.def.ghi, sk-abcdefghijklmnopqrstuv");
    expect(text).not.toContain("mm-very-secret-key-123");
    expect(text).not.toContain("abc.def.ghi");
    expect(text).not.toContain("sk-abcdefghijklmnopqrstuv");
  });

  it("ignores values too short to be secrets", () => {
    const redactor = new Redactor();
    redactor.addSecret("abc");
    expect(redactor.redact("abc")).toBe("abc");
  });
});

describe("snapshot exclusions", () => {
  it("never copies git internals, runtime data, build caches or env files", () => {
    for (const file of [".git", ".scratch/x.md", ".eve/state", "traces/a.jsonl", ".env", ".env.local", "apps/web/.next/cache"]) {
      expect(NOT_SNAPSHOTTED.test(file)).toBe(true);
    }
    for (const file of ["src/core/x.ts", "apps/web/app/page.tsx", "node_modules/.bin/eve", "docs/environment.md"]) {
      expect(NOT_SNAPSHOTTED.test(file)).toBe(false);
    }
  });
});

describe("world API expectations", () => {
  const trace = { spans: [{ name: "chat errand-script", kind: "model" }, { name: "execute_tool search_providers", kind: "tool" }], totals: { toolCalls: 1 } };

  it("reads dot paths and maps [*] over arrays", () => {
    expect(valueAt(trace, "totals.toolCalls")).toBe(1);
    expect(valueAt(trace, "spans[*].kind")).toEqual(["model", "tool"]);
  });

  it("reports what is unmet, and nothing when met", () => {
    expect(unmetExpectation(trace, { path: "spans[*].name", includes: "execute_tool search_providers" })).toBeUndefined();
    expect(unmetExpectation(trace, { path: "totals.toolCalls", equals: 2 })).toMatch(/expected 2/);
    expect(unmetExpectation(trace, { path: "spans", atLeast: 3 })).toMatch(/at least 3/);
  });

  it("refuses an expectation that checks nothing", () => {
    expect(() => parseExpectations({ path: "spans" })).toThrow(/needs equals/);
  });

  it("puts the page's session into sessions/current", () => {
    expect(resolveSession("/api/v1/sessions/current/trace", "wrun_1")).toBe("/api/v1/sessions/wrun_1/trace");
    expect(() => resolveSession("/api/v1/sessions/current/trace", undefined)).toThrow(/No chat session/);
  });
});

describe("suite manifests", () => {
  const scenario = (steps: unknown[]) => ({ version: 1, title: "t", feature: "f", scenarios: [{ id: "s", title: "s", steps }] });

  it("accepts every seed suite", () => {
    const directory = path.resolve(import.meta.dirname, "../../../verification/suites");
    const files = fs.readdirSync(directory).filter((file) => file.endsWith(".json"));
    expect(files.sort()).toEqual(["chat-search.json", "design-system.json", "trace-panel.json"]);
    for (const file of files) expect(() => validateSuite(JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")))).not.toThrow();
  });

  it("refuses a scenario with no assertion", () => {
    expect(() => validateSuite(scenario([{ command: "goto", args: ["/"] }]))).toThrow(/no assertion/);
  });

  it("refuses a scenario whose last action has no outcome assertion", () => {
    const steps = [{ command: "goto", args: ["/"] }, { command: "assert", args: ["html"], options: { attr: "data-theme=dark" } }, { command: "click", options: { role: "button", name: "x" } }];
    expect(() => validateSuite(scenario(steps))).toThrow(/ends with an action/);
  });

  it("has no command that runs page script", () => {
    const step = { command: ["e", "val"].join(""), args: ["1"] };
    expect(() => validateSuite(scenario([step, { command: "assert", args: ["html"], options: { count: 1 } }]))).toThrow(/unsupported command/);
  });

  it("turns JSON options into command options", () => {
    expect(stepOptions({ command: "api", options: { body: { seed: 42 }, timeoutMs: 500 } })).toEqual({ body: '{"seed":42}', "timeout-ms": "500" });
  });
});

describe("HTML report", () => {
  const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5d70000000049454e44ae426082", "hex");

  function reportIn(directory: string, screenshots: string[]): SuiteReport {
    const evidence = path.join(directory, "s");
    fs.mkdirSync(evidence, { recursive: true });
    for (const name of screenshots) fs.writeFileSync(path.join(evidence, name), PNG);
    return {
      version: 1,
      title: "t",
      feature: "f",
      manifest: "m.json",
      manifestDigest: "d",
      startedAt: new Date(0).toISOString(),
      provenance: { revision: "r" },
      scenarios: [{ id: "s", title: "s", status: "PASS", theme: "dark", viewport: "desktop", evidence, steps: [{ index: 0, phase: "step", command: "assert", status: "PASS", screenshots }] }],
      counts: { PASS: 1, FAIL: 0, BLOCKED: 0, "NOT RUN": 0 },
      status: "PASS",
      ok: true,
      report: path.join(directory, "report.json"),
    };
  }

  it("embeds screenshots under a strict CSP and loads nothing external", () => {
    const directory = temporary();
    const html = fs.readFileSync(writeHtmlReport(reportIn(directory, ["step-0-outcome.png"])), "utf8");
    expect(html).toContain("default-src 'none'; img-src data:");
    expect(html).toContain("data:image/png;base64,");
    expect(html).not.toMatch(/(src|href)="https?:/);
  });

  it("refuses PASS without screenshots", () => {
    expect(() => writeHtmlReport(reportIn(temporary(), []))).toThrow(/PASS needs screenshot evidence/);
  });

  it("never overwrites an earlier report", () => {
    const report = reportIn(temporary(), ["a.png"]);
    writeHtmlReport(report);
    expect(() => writeHtmlReport(report)).toThrow(/EEXIST/);
  });
});

describe("skill link", () => {
  it("links the skill, replaces an older link, and refuses to overwrite a real directory", () => {
    const skills = temporary();
    const first = linkSkill({ source: "/nonexistent/one", skillsDirectory: skills });
    expect(first.resolves).toBe(false);
    const second = linkSkill({ source: skills, skillsDirectory: skills });
    expect(second.replacedLink).toBe("/nonexistent/one");
    fs.unlinkSync(path.join(skills, "verify-errand"));
    fs.mkdirSync(path.join(skills, "verify-errand"));
    expect(() => linkSkill({ source: skills, skillsDirectory: skills })).toThrow(/not a symbolic link/);
  });
});
