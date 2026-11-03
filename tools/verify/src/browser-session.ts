import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright-core";

import { integerOption, jsonOption, stringOption, type Options } from "./cli-arguments";
import { cleanUrl, GUARD_PROBE_URL, guardLaunchArgs, installNetworkGuard, runOrigins, type GuardEvent } from "./network-guard";
import type { Redactor } from "./redaction";
import { appendPrivateLine, evidenceFile } from "./run-paths";
import { listenersOn, ownedProcesses, type RunState } from "./runtime";
import { sourceIdentity } from "./source-identity";
import { describeTarget, hasTarget, locatorFor, type Target } from "./targets";
import type { RunCredentials } from "./runtime";
import { callApi, parseApiMethod, parseExpectations, resolveSession, unmetExpectation, type ApiResult } from "./world-api";

// One owned Chrome per run. The daemon keeps a root context whose page every CLI command drives; a
// suite gets a fresh context per scenario. Every context has the network guard, blocks service
// workers, and writes its own browser.jsonl: actions, console, page errors, and each request's
// method, origin + path and status (never a query string or a body).

export const DEFAULT_TIMEOUT_MS = 15_000;
export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  laptop: { width: 1280, height: 800 },
  tablet: { width: 834, height: 1112 },
  phone: { width: 390, height: 844 },
} as const;
export type Theme = "dark" | "light";
const SESSION_PATH = /^\/eve\/v1\/session\/([A-Za-z0-9_-]{1,128})(\/|$)/;
/** A suite's `fill` value that stands for the run's operator token. */
export const OPERATOR_TOKEN_PLACEHOLDER = "{{operator-token}}";

export type ApiCaller = "person" | "operator" | "other-person";

/** Who an `api` call is made as: the dev person (default), the run's operator, or a second person. */
export function parseApiCaller(value: string | undefined): ApiCaller {
  if (value === undefined || value === "person" || value === "operator" || value === "other-person") return value ?? "person";
  throw new Error("api --as takes person, operator or other-person");
}
const LIST_LIMIT = 200;

/** An expected failure of the product under test (FAIL), as opposed to a broken setup (BLOCKED). */
export class CommandFailure extends Error {
  readonly blocked: boolean;
  constructor(message: string, { blocked = false } = {}) {
    super(message);
    this.name = "CommandFailure";
    this.blocked = blocked;
  }
}

export type CommandResult = { readonly ok: boolean } & Record<string, unknown>;

export function parseViewport(value: string): { width: number; height: number } {
  if (value in VIEWPORTS) return VIEWPORTS[value as keyof typeof VIEWPORTS];
  const match = value.match(/^(\d{3,4})x(\d{3,4})$/);
  if (!match) throw new Error(`viewport takes ${Object.keys(VIEWPORTS).join(", ")} or WIDTHxHEIGHT`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

export function parseTheme(value: string | undefined): Theme {
  if (value === undefined || value === "dark" || value === "light") return value ?? "dark";
  throw new Error("theme is dark or light");
}

function timeoutOf(options: Options): number {
  return integerOption(options, "timeout-ms", 0, 600_000) ?? DEFAULT_TIMEOUT_MS;
}

export function targetOf(words: readonly string[], options: Options): Target {
  const nth = integerOption(options, "nth", 0, 10_000);
  return {
    selector: words[1],
    role: stringOption(options, "role"),
    name: stringOption(options, "name"),
    text: stringOption(options, "text"),
    label: stringOption(options, "label"),
    testid: stringOption(options, "testid"),
    ...(nth === undefined ? {} : { nth }),
  };
}

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface SessionSettings {
  readonly evidence: string;
  readonly theme: Theme;
  readonly viewport?: string;
}

export interface DoctorContext {
  readonly childrenAlive: () => boolean;
}

export class BrowserHost {
  readonly #browser: Browser;
  readonly #state: RunState;
  readonly #redactor: Redactor;
  readonly #credentials: RunCredentials;
  readonly #sessions = new Set<BrowserSession>();

  private constructor(browser: Browser, state: RunState, redactor: Redactor, credentials: RunCredentials) {
    this.#browser = browser;
    this.#state = state;
    this.#redactor = redactor;
    this.#credentials = credentials;
  }

  static async launch(state: RunState, redactor: Redactor, credentials: RunCredentials): Promise<BrowserHost> {
    const browser = await chromium.launch({ channel: "chrome", headless: !state.headed, args: guardLaunchArgs() });
    return new BrowserHost(browser, state, redactor, credentials);
  }

  get credentials(): RunCredentials {
    return this.#credentials;
  }

  get version(): string {
    return this.#browser.version();
  }

  get connected(): boolean {
    return this.#browser.isConnected();
  }

  async newSession(settings: SessionSettings): Promise<BrowserSession> {
    const context = await this.#browser.newContext({
      viewport: parseViewport(settings.viewport ?? "desktop"),
      colorScheme: settings.theme,
      serviceWorkers: "block",
      locale: "en-IN",
      timezoneId: "Asia/Kolkata",
    });
    try {
      const session = await BrowserSession.open(context, this.#state, this.#redactor, settings, this);
      this.#sessions.add(session);
      return session;
    } catch (error) {
      await context.close().catch(() => undefined);
      throw error;
    }
  }

  forget(session: BrowserSession): void {
    this.#sessions.delete(session);
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.#sessions].map((session) => session.close()));
    await this.#browser.close();
  }
}

export class BrowserSession {
  readonly #context: BrowserContext;
  readonly #page: Page;
  readonly #state: RunState;
  readonly #redactor: Redactor;
  readonly #host: BrowserHost;
  readonly #log: string;
  readonly evidence: string;
  #guardInstalled = false;
  #currentSession: string | undefined;
  #closed = false;

  private constructor(context: BrowserContext, page: Page, state: RunState, redactor: Redactor, evidence: string, host: BrowserHost) {
    this.#context = context;
    this.#page = page;
    this.#state = state;
    this.#redactor = redactor;
    this.#host = host;
    this.evidence = evidence;
    this.#log = path.join(evidence, "browser.jsonl");
  }

  static async open(context: BrowserContext, state: RunState, redactor: Redactor, settings: SessionSettings, host: BrowserHost): Promise<BrowserSession> {
    const page = await context.newPage();
    const session = new BrowserSession(context, page, state, redactor, settings.evidence, host);
    // Installed before the first navigation: nothing this context loads can leave the run.
    await installNetworkGuard(context, runOrigins([state.ports.web, state.ports.backend]), (event: GuardEvent) => session.record({ ...event }));
    session.#guardInstalled = true;
    session.#listen(page);
    page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(90_000);
    return session;
  }

  get currentSession(): string | undefined {
    return this.#currentSession;
  }

  record(event: Record<string, unknown>): void {
    const line = this.#redactor.redact(JSON.stringify({ time: new Date().toISOString(), ...event }));
    appendPrivateLine(this.#log, line);
  }

  #listen(page: Page): void {
    const origins = runOrigins([this.#state.ports.web, this.#state.ports.backend]);
    page.on("console", (message) => this.record({ type: "console", level: message.type(), message: message.text().slice(0, 2000) }));
    page.on("pageerror", (error) => this.record({ type: "pageerror", message: error.message.slice(0, 2000) }));
    page.on("request", (request) => {
      const url = cleanUrl(request.url());
      const session = (() => {
        try {
          return new URL(request.url()).pathname.match(SESSION_PATH)?.[1];
        } catch {
          return undefined;
        }
      })();
      if (session !== undefined) this.#currentSession = session;
      this.record({ type: "request", method: request.method(), url, resourceType: request.resourceType() });
    });
    page.on("response", (response) =>
      this.record({ type: "response", method: response.request().method(), url: cleanUrl(response.url()), status: response.status() }),
    );
    page.on("requestfailed", (request) =>
      this.record({ type: "requestfailed", method: request.method(), url: cleanUrl(request.url()), error: request.failure()?.errorText ?? "unknown" }),
    );
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      const url = frame.url();
      let origin = "";
      try {
        origin = new URL(url).origin;
      } catch {
        origin = "";
      }
      if (!url.startsWith("about:") && !origins.has(origin)) this.record({ type: "navigation-off-run", url: cleanUrl(url) });
    });
  }

  // Commands. Each returns evidence; a failed expectation throws CommandFailure.

  async command(words: readonly string[], options: Options): Promise<CommandResult> {
    const name = words[0] ?? "";
    const target = targetOf(words, options);
    if (["click", "hover", "fill"].includes(name)) this.record({ type: "action", command: name, target: describeTarget(target) });
    if (["goto", "reload", "type", "key"].includes(name)) this.record({ type: "action", command: name, ...(name === "goto" ? { route: new URL(words[1] ?? "/", "http://route.invalid").pathname } : {}) });
    switch (name) {
      case "goto":
        return await this.goto(words[1]);
      case "reload":
        await this.#page.reload({ waitUntil: "load" });
        return { ok: true, url: cleanUrl(this.#page.url()) };
      case "click": {
        // --clicks 2 is a real double click (two clicks in one gesture), as an impatient person makes.
        const clicks = integerOption(options, "clicks", 1, 3) ?? 1;
        await this.#unique(target).click({ timeout: timeoutOf(options), clickCount: clicks });
        return { ok: true, target: describeTarget(target), ...(clicks === 1 ? {} : { clicks }) };
      }
      case "hover":
        await this.#unique(target).hover({ timeout: timeoutOf(options) });
        return { ok: true, target: describeTarget(target) };
      case "fill": {
        const written = stringOption(options, "value");
        if (written === undefined) throw new Error("fill needs --value TEXT");
        // The run's operator token is typed where a suite asks for it, as an operator would paste
        // theirs; the suite never holds it, and the redactor keeps it out of every log.
        const value = written === OPERATOR_TOKEN_PLACEHOLDER ? this.#host.credentials.operatorToken : written;
        await this.#unique(target).fill(value, { timeout: timeoutOf(options) });
        return { ok: true, target: describeTarget(target), characters: value.length };
      }
      case "type": {
        if (words[1] === undefined) throw new Error("type needs TEXT (typed into the focused element)");
        await this.#page.keyboard.type(words[1]);
        return { ok: true, characters: words[1].length };
      }
      case "key": {
        if (words[1] === undefined) throw new Error("key needs a key, e.g. Enter, Escape or ControlOrMeta+A");
        await this.#page.keyboard.press(words[1]);
        return { ok: true, key: words[1] };
      }
      case "wait":
        return await this.wait(target, options);
      case "text":
        return await this.text(target);
      case "count":
        return { ok: true, target: describeTarget(target), count: await this.#locator(target).count() };
      case "assert":
        return await this.assert(target, options);
      case "locate":
        return await this.locate(target, options);
      case "viewport": {
        const size = parseViewport(words[1] ?? "");
        await this.#page.setViewportSize(size);
        return { ok: true, viewport: size };
      }
      case "theme": {
        const theme = parseTheme(words[1]);
        await this.#page.emulateMedia({ colorScheme: theme });
        return { ok: true, systemTheme: theme };
      }
      case "screenshot":
        return { ok: true, ...(await this.screenshot(words[1], { fullPage: options.viewport !== true })) };
      case "snapshot":
        // words[1] is the file name; the optional scope comes from the target options alone.
        return await this.snapshot(words[1], targetOf([], options));
      case "network":
        return await this.network(options);
      case "logs":
        return await this.logs(options);
      case "api":
        return await this.api(words, options);
      default:
        throw new Error(`Unknown browser command: ${name}`);
    }
  }

  async goto(route: string | undefined): Promise<CommandResult> {
    if (route === undefined || !route.startsWith("/") || route.startsWith("//")) throw new Error("goto takes a route on the run's web app, e.g. / or /design");
    // `/ops/sessions/current` and `/chat/current` open the session this context chatted in.
    const resolved = resolveSession(route, this.#currentSession);
    const response = await this.#page.goto(new URL(resolved, this.#state.urls.web).href, { waitUntil: "load" });
    return { ok: true, url: cleanUrl(this.#page.url()), status: response?.status() ?? null };
  }

  #locator(target: Target, textIsName = true): Locator {
    return locatorFor(this.#page, target, { textIsName });
  }

  /** Actions need exactly one element; Playwright's strict mode refuses an ambiguous match. */
  #unique(target: Target): Locator {
    if (!hasTarget(target)) throw new Error("Name a target: a CSS selector, or --role ROLE --name NAME, --label, --testid or --text");
    return this.#locator(target);
  }

  async wait(target: Target, options: Options): Promise<CommandResult> {
    const state = stringOption(options, "state") ?? "visible";
    if (!["visible", "hidden", "attached", "detached"].includes(state)) throw new Error("--state is visible, hidden, attached or detached");
    const started = Date.now();
    await this.#unique(target).waitFor({ state: state as "visible", timeout: timeoutOf(options) });
    return { ok: true, target: describeTarget(target), state, waitedMs: Date.now() - started };
  }

  async text(target: Target): Promise<CommandResult> {
    const locator = this.#unique(target);
    const texts = (await locator.allInnerTexts()).slice(0, 50).map((text) => this.#redactor.redact(normalize(text)).slice(0, 4000));
    return { ok: true, target: describeTarget(target), count: await locator.count(), texts };
  }

  /** One check against the page; returns why it fails, or undefined when it holds. */
  async #check(target: Target, options: Options): Promise<string | undefined> {
    const url = stringOption(options, "url");
    if (url !== undefined) {
      const actual = new URL(this.#page.url());
      const expected = new URL(url, this.#state.urls.web);
      const matches = actual.pathname === expected.pathname && (expected.search === "" || actual.search === expected.search);
      return matches ? undefined : `url is ${actual.pathname}, expected ${expected.pathname}${expected.search}`;
    }
    const locator = this.#locator(target, false);
    const count = await locator.count();
    const expectedCount = integerOption(options, "count", 0, 1_000_000);
    if (expectedCount !== undefined) return count === expectedCount ? undefined : `found ${count}, expected ${expectedCount}`;
    const state = stringOption(options, "state");
    if (state === "detached") return count === 0 ? undefined : `found ${count}, expected none`;
    if (state === "hidden") {
      for (let index = 0; index < count; index++) if (await locator.nth(index).isVisible()) return `match ${index} is visible, expected hidden`;
      return undefined;
    }
    if (state === "attached") return count > 0 ? undefined : "no match";
    if (count === 0) return "no match";
    if (count > 1) return `${count} matches; refine the target or add --nth`;
    const element = locator.first();
    if (state === "visible" && !(await element.isVisible())) return "the match is not visible";
    const text = stringOption(options, "text");
    if (text !== undefined) {
      const actual = normalize(await element.innerText());
      if (!actual.includes(normalize(text))) return `text is ${JSON.stringify(actual.slice(0, 300))}, expected it to contain ${JSON.stringify(text)}`;
    }
    const value = stringOption(options, "value");
    if (value !== undefined) {
      const actual = await element.inputValue();
      if (actual !== value) return `value has ${actual.length} characters and differs from the expected ${value.length}`;
    }
    const attribute = stringOption(options, "attr");
    if (attribute !== undefined) {
      const separator = attribute.indexOf("=");
      if (separator < 1) throw new Error("--attr is name=value");
      const [key, expected] = [attribute.slice(0, separator), attribute.slice(separator + 1)];
      const actual = await element.getAttribute(key);
      if (actual !== expected) return `${key} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`;
    }
    // A computed style, for what only shows as paint (a focus ring, a colour): read, never set.
    const style = stringOption(options, "style");
    if (style !== undefined) {
      const separator = style.indexOf("=");
      if (separator < 1) throw new Error("--style is property=value, e.g. outline-style=none");
      const [property, expected] = [style.slice(0, separator), style.slice(separator + 1)];
      const actual = await element.evaluate((node, name) => getComputedStyle(node).getPropertyValue(name), property);
      if (actual !== expected) return `${property} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`;
    }
    return undefined;
  }

  /** Retries until the expectation holds or the timeout passes (default 15000 ms). */
  async assert(target: Target, options: Options): Promise<CommandResult> {
    const expectations = ["text", "value", "count", "attr", "style", "state", "url"].filter((key) => options[key] !== undefined);
    if (expectations.length === 0) throw new Error("assert needs an expectation: --text, --value, --count, --attr, --style, --state or --url");
    if (options.url === undefined && !hasTarget({ ...target, text: undefined })) {
      throw new Error("assert needs a target (in assert, --text is the expected text, not the target)");
    }
    const timeout = timeoutOf(options);
    const started = Date.now();
    let reason: string | undefined;
    do {
      reason = await this.#check(target, options).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
      if (reason === undefined) {
        // Bring what was asserted into view, so the outcome screenshot shows it.
        if (options.url === undefined) await this.#scrollTo(target);
        return { ok: true, target: options.url === undefined ? describeTarget({ ...target, text: undefined }) : `url ${String(options.url)}`, expectations, waitedMs: Date.now() - started };
      }
      await delay(100);
    } while (Date.now() - started < timeout);
    const subject = options.url === undefined ? describeTarget({ ...target, text: undefined }) : "url";
    // The failure screenshot should show the element that failed, not wherever the page scrolled.
    if (options.url === undefined) await this.#scrollTo(target);
    throw new CommandFailure(`assert ${subject}: ${reason} (after ${Date.now() - started} ms)`);
  }

  async #scrollTo(target: Target): Promise<void> {
    const locator = this.#locator(target, false);
    if ((await locator.count().catch(() => 0)) === 0) return;
    await locator.first().scrollIntoViewIfNeeded({ timeout: 1_000 }).catch(() => undefined);
  }

  /** Match count, uniqueness and actionability without acting, plus the suite step to reuse. */
  async locate(target: Target, options: Options): Promise<CommandResult> {
    const operation = stringOption(options, "operation") ?? "click";
    if (!["click", "hover", "fill"].includes(operation)) throw new Error("--operation is click, hover or fill");
    const all = this.#unique({ ...target, nth: undefined });
    const count = await all.count();
    const positional = target.nth !== undefined;
    const unique = positional ? (target.nth ?? 0) < count : count === 1;
    let visible = false;
    let enabled = false;
    let editable = false;
    if (unique) {
      const element = positional ? all.nth(target.nth ?? 0) : all.first();
      visible = await element.isVisible();
      enabled = await element.isEnabled();
      editable = operation === "fill" ? await element.isEditable() : false;
    }
    const actionable = unique && visible && enabled && (operation !== "fill" || editable);
    const stepOptions = Object.fromEntries(Object.entries(target).filter(([key, value]) => key !== "selector" && value !== undefined));
    const step = { command: operation, ...(target.selector === undefined ? {} : { args: [target.selector] }), options: { ...stepOptions, ...(operation === "fill" ? { value: "VALUE" } : {}) } };
    return {
      ok: actionable,
      target: describeTarget(target),
      count,
      unique,
      visible,
      enabled,
      actionable,
      ...(positional ? { positional: true, note: "A positional match must be tied to observed content: assert that content before acting." } : {}),
      ...(actionable ? { step } : {}),
    };
  }

  async screenshot(name: string | undefined, { fullPage }: { fullPage: boolean }): Promise<{ file: string }> {
    const file = evidenceFile(this.evidence, name ?? `screen-${Date.now()}.png`);
    if (!file.endsWith(".png")) throw new Error("Screenshots are .png files");
    await this.#page.screenshot({ path: file, fullPage, mask: [this.#page.locator('input[type="password"]')], animations: "disabled" });
    fs.chmodSync(file, 0o600);
    return { file };
  }

  async snapshot(name: string | undefined, target: Target): Promise<CommandResult> {
    const file = evidenceFile(this.evidence, name ?? `snapshot-${Date.now()}.txt`);
    const scope = hasTarget({ ...target, selector: undefined }) || target.selector !== undefined ? this.#unique(target) : this.#page.locator("body");
    const tree = this.#redactor.redact(await scope.ariaSnapshot());
    fs.writeFileSync(file, `${tree}\n`, { mode: 0o600 });
    return { ok: true, file, lines: tree.split("\n").length, tree: tree.length > 20_000 ? `${tree.slice(0, 20_000)}\n… (truncated; see the file)` : tree };
  }

  async *#entries(): AsyncGenerator<Record<string, unknown>> {
    if (!fs.existsSync(this.#log)) return;
    const lines = createInterface({ input: fs.createReadStream(this.#log, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of lines) {
      if (line) yield JSON.parse(line) as Record<string, unknown>;
    }
  }

  async network(options: Options): Promise<CommandResult> {
    const method = stringOption(options, "method")?.toUpperCase();
    const pathFilter = stringOption(options, "path");
    const status = integerOption(options, "status", 100, 599);
    const since = stringOption(options, "since");
    if (since !== undefined && !Number.isFinite(Date.parse(since))) throw new Error("--since is an ISO timestamp");
    if (pathFilter !== undefined && (!pathFilter.startsWith("/") || pathFilter.includes("?"))) throw new Error("--path is a pathname (no query); end it with * for a prefix");
    const matchesPath = (url: string) => {
      if (pathFilter === undefined) return true;
      const pathname = new URL(url).pathname;
      return pathFilter.endsWith("*") ? pathname.startsWith(pathFilter.slice(0, -1)) : pathname === pathFilter;
    };
    const lists = { requests: [] as unknown[], responses: [] as unknown[], failed: [] as unknown[], blocked: [] as unknown[] };
    const counts = { requests: 0, responses: 0, failed: 0, blocked: 0 };
    const push = (key: keyof typeof lists, entry: unknown) => {
      counts[key]++;
      lists[key].push(entry);
      if (lists[key].length > LIST_LIMIT) lists[key].shift();
    };
    for await (const entry of this.#entries()) {
      const type = entry.type;
      if (since !== undefined && Date.parse(String(entry.time)) < Date.parse(since)) continue;
      if (type === "network-guard-blocked") {
        push("blocked", entry);
        continue;
      }
      if (type !== "request" && type !== "response" && type !== "requestfailed") continue;
      if (method !== undefined && entry.method !== method) continue;
      if (!matchesPath(String(entry.url))) continue;
      if (type === "requestfailed") {
        if (status === undefined) push("failed", entry);
        continue;
      }
      if (status !== undefined && entry.status !== status) continue;
      push(type === "request" ? "requests" : "responses", entry);
    }
    return {
      ok: true,
      count: status === undefined ? counts.requests : counts.responses,
      countSource: status === undefined ? "requests" : "responses",
      counts,
      ...lists,
      truncated: Object.entries(counts).some(([key, count]) => count > lists[key as keyof typeof lists].length),
    };
  }

  async logs(options: Options): Promise<CommandResult> {
    const level = stringOption(options, "level");
    const since = stringOption(options, "since");
    const entries: unknown[] = [];
    let count = 0;
    let pageErrors = 0;
    for await (const entry of this.#entries()) {
      if (entry.type !== "console" && entry.type !== "pageerror") continue;
      if (since !== undefined && Date.parse(String(entry.time)) < Date.parse(since)) continue;
      if (level !== undefined && entry.type === "console" && entry.level !== level) continue;
      if (entry.type === "pageerror") pageErrors++;
      count++;
      entries.push(entry);
      if (entries.length > LIST_LIMIT) entries.shift();
    }
    return { ok: true, count, pageErrors, entries };
  }

  /** `api METHOD /api/v1/...` through packages/client, with optional expectations that retry (GET only). */
  async api(words: readonly string[], options: Options): Promise<CommandResult> {
    const method = parseApiMethod(words[1]);
    const route = words[2];
    if (route === undefined) throw new Error("api needs METHOD /api/v1/PATH");
    const body = jsonOption(options, "body");
    const expectations = parseExpectations(jsonOption(options, "expect"));
    const caller = parseApiCaller(stringOption(options, "as"));
    const accessToken = caller === "operator" ? this.#host.credentials.operatorToken : caller === "other-person" ? this.#host.credentials.otherPersonToken : undefined;
    // --status N expects that HTTP status (a refusal, say), checked once: a refusal is never retried into a pass.
    const expectedStatus = integerOption(options, "status", 100, 599);
    if (expectedStatus !== undefined && expectations.length > 0) throw new Error("api takes --status or --expect, not both");
    const timeout = timeoutOf(options);
    const started = Date.now();
    let result: ApiResult;
    let reason: string | undefined;
    do {
      const resolved = resolveSession(route, this.#currentSession);
      result = await callApi(this.#state.urls.backend, { method, path: resolved, body }, accessToken);
      if (expectedStatus !== undefined) {
        reason = result.status === expectedStatus ? undefined : `HTTP ${result.status}, expected ${expectedStatus}`;
        break;
      }
      reason = !result.ok ? `HTTP ${result.status} ${result.error?.code ?? ""}`.trim() : expectations.map((expectation) => unmetExpectation(result.body, expectation)).find(Boolean);
      // A write is sent once: never replay an uncertain write to get a pass.
      if (reason === undefined || method !== "GET" || expectations.length === 0) break;
      await delay(250);
    } while (Date.now() - started < timeout);
    if (reason !== undefined && (expectations.length > 0 || expectedStatus !== undefined || !result.ok)) {
      throw new CommandFailure(`api ${method} ${result.route} as ${caller}: ${reason}`);
    }
    return { ...result, ok: true, as: caller, checked: expectations.length + (expectedStatus === undefined ? 0 : 1) };
  }

  // Doctor: is this run what it claims to be, and is the guard actually blocking?

  async #probeGuard(): Promise<boolean> {
    const started = new Date().toISOString();
    const probe = await this.#context.newPage();
    let blocked = false;
    try {
      await probe.goto(GUARD_PROBE_URL, { timeout: 10_000 });
    } catch (error) {
      blocked = /ERR_BLOCKED_BY_CLIENT/.test(error instanceof Error ? error.message : String(error));
    } finally {
      await probe.close().catch(() => undefined);
    }
    if (!blocked) return false;
    for await (const entry of this.#entries()) {
      if (entry.type === "network-guard-blocked" && entry.probe === true && String(entry.time) >= started) return true;
    }
    return false;
  }

  async doctor(context: DoctorContext): Promise<CommandResult> {
    const state = this.#state;
    // Every listener on a run port must be a process this run started. Retried briefly: a dev
    // server can hand its socket from a starter process to a worker while the doctor looks.
    const portsOwned = () =>
      state.processes.every((owned) => {
        const pids = ownedProcesses({ roots: [owned.pid], marker: state.snapshot });
        return owned.ports.every((port) => {
          const listeners = listenersOn(port);
          return listeners.length > 0 && listeners.every((pid) => pids.includes(pid));
        });
      });
    let ownedPorts = portsOwned();
    for (let attempt = 0; attempt < 10 && !ownedPorts; attempt++) {
      await delay(500);
      ownedPorts = portsOwned();
    }
    let source: ReturnType<typeof sourceIdentity> | undefined;
    try {
      source = sourceIdentity(state.checkout);
    } catch {
      source = undefined;
    }
    let backendHealth = false;
    try {
      const result = await callApi(state.urls.backend, { method: "GET", path: "/api/v1/providers?ids=doctor-probe" });
      backendHealth = result.ok;
    } catch {
      backendHealth = false;
    }
    let webReady = false;
    try {
      webReady = (await fetch(state.urls.web, { signal: AbortSignal.timeout(30_000) })).ok;
    } catch {
      webReady = false;
    }
    const checks = {
      ownedProcesses: context.childrenAlive(),
      ownedPorts,
      sourceRevision: source?.revision === state.revision,
      sourceDiff: source?.sourceDigest === state.sourceDigest,
      backendHealth,
      webReady,
      browser: this.#host.connected && !this.#page.isClosed(),
      networkGuard: this.#guardInstalled && (await this.#probeGuard()),
    };
    const ok = Object.values(checks).every(Boolean);
    return {
      ok,
      ...(ok ? {} : { status: "BLOCKED" }),
      checks,
      run: state.runId,
      urls: state.urls,
      ports: state.ports,
      branch: state.branch,
      revision: state.revision,
      sourceDigest: state.sourceDigest,
      live: state.live,
      models: state.models,
      clockStart: state.clockStart,
      evidence: state.evidence,
      snapshot: state.snapshot,
      notes: [
        "Source edits after launch are not picked up: relaunch with a new run ID.",
        "networkGuard: a request to example.com was aborted and logged as network-guard-blocked (probe: true); see `network`.",
        checks.sourceDiff ? null : "The checkout changed since launch: this run verifies the launch-time snapshot. Clean up and relaunch.",
        state.live ? "Live: the backend's main model is MiniMax (key from the Keychain, held only in the backend's environment)." : "Scripted models: no key and no network for the model.",
      ].filter(Boolean),
    };
  }

  /** Requests the guard blocked in this context, excluding the doctor's own probe. */
  async blockedFindings(): Promise<unknown[]> {
    const found: unknown[] = [];
    for await (const entry of this.#entries()) if (entry.type === "network-guard-blocked" && entry.probe !== true) found.push(entry);
    return found;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#host.forget(this);
    await this.#context.close();
  }
}
