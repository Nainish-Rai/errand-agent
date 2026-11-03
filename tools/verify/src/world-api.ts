import { ApiClient, ApiRequestError } from "@errand/client";
import {
  API_PREFIX,
  InjectWorldFaultRequestSchema,
  LoadModelScriptRequestSchema,
  ProposalStatusSchema,
  SetRunLimitsRequestSchema,
  SwitchScenarioRequestSchema,
} from "@errand/contracts";

// World state next to UI state: `api GET /api/v1/...` goes through packages/client, so every body
// is parsed against its contract. Only routes the client knows are reachable; the tool never builds
// its own requests to the backend.

export type ApiMethod = "GET" | "POST" | "PUT";

export interface ApiCall {
  readonly method: ApiMethod;
  /** `/api/v1/...`, query string allowed. `sessions/current/...` means the page's chat session. */
  readonly path: string;
  readonly body?: unknown;
}

export interface ApiResult {
  readonly ok: boolean;
  readonly method: ApiMethod;
  readonly route: string;
  readonly status: number;
  readonly body: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

type Handler = (client: ApiClient, match: readonly (string | undefined)[], url: URL, body: unknown) => Promise<unknown>;

interface Route {
  readonly method: ApiMethod;
  readonly pattern: RegExp;
  readonly route: string;
  readonly handle: Handler;
}

const ROUTES: readonly Route[] = [
  {
    method: "GET",
    pattern: /^\/providers$/,
    route: "GET /api/v1/providers?ids=",
    handle: async (client, _match, url) => ({
      providers: await client.getProviders(
        (url.searchParams.get("ids") ?? "")
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    }),
  },
  {
    method: "GET",
    pattern: /^\/providers\/([^/]+)$/,
    route: "GET /api/v1/providers/:id",
    handle: async (client, match) => ({ provider: await client.getProvider(decodeURIComponent(match[1] ?? "")) }),
  },
  {
    method: "GET",
    pattern: /^\/sessions\/([^/]+)\/trace$/,
    route: "GET /api/v1/sessions/:id/trace",
    handle: async (client, match) => await client.getSessionTrace(decodeURIComponent(match[1] ?? "")),
  },
  {
    method: "GET",
    pattern: /^\/sessions\/([^/]+)\/errand$/,
    route: "GET /api/v1/sessions/:id/errand",
    handle: async (client, match) => ({ errand: await client.getErrand(decodeURIComponent(match[1] ?? "")) }),
  },
  {
    method: "GET",
    pattern: /^\/sessions\/([^/]+)\/proposals$/,
    route: "GET /api/v1/sessions/:id/proposals",
    handle: async (client, match) => ({ proposals: await client.listSessionProposals(decodeURIComponent(match[1] ?? "")) }),
  },
  {
    method: "GET",
    pattern: /^\/proposals$/,
    route: "GET /api/v1/proposals?status=",
    handle: async (client, _match, url) => {
      const status = url.searchParams.get("status");
      return { proposals: await client.listProposals(status === null ? {} : { status: ProposalStatusSchema.parse(status) }) };
    },
  },
  {
    method: "GET",
    pattern: /^\/proposals\/([^/]+)$/,
    route: "GET /api/v1/proposals/:id",
    handle: async (client, match) => ({ proposal: await client.getProposal(decodeURIComponent(match[1] ?? "")) }),
  },
  {
    method: "GET",
    pattern: /^\/bookings$/,
    route: "GET /api/v1/bookings",
    handle: async (client) => ({ bookings: await client.listBookings() }),
  },
  {
    method: "POST",
    pattern: /^\/dev\/scenario$/,
    route: "POST /api/v1/dev/scenario",
    handle: async (client, _match, _url, body) => await client.switchScenario(SwitchScenarioRequestSchema.parse(body)),
  },
  {
    method: "PUT",
    pattern: /^\/dev\/model-script$/,
    route: "PUT /api/v1/dev/model-script",
    handle: async (client, _match, _url, body) => await client.loadModelScript(LoadModelScriptRequestSchema.parse(body)),
  },
  {
    method: "PUT",
    pattern: /^\/dev\/run-limits$/,
    route: "PUT /api/v1/dev/run-limits",
    handle: async (client, _match, _url, body) => await client.setRunLimits(SetRunLimitsRequestSchema.parse(body)),
  },
  {
    method: "PUT",
    pattern: /^\/dev\/world-fault$/,
    route: "PUT /api/v1/dev/world-fault",
    handle: async (client, _match, _url, body) => await client.injectWorldFault(InjectWorldFaultRequestSchema.parse(body)),
  },
];

export const KNOWN_ROUTES = ROUTES.map((route) => route.route);

export function parseApiMethod(value: string | undefined): ApiMethod {
  const method = (value ?? "").toUpperCase();
  if (method === "GET" || method === "POST" || method === "PUT") return method;
  throw new Error("api takes GET, POST or PUT");
}

/** Replaces `sessions/current/` with the session the page is chatting in. */
export function resolveSession(path: string, currentSession: string | undefined): string {
  if (!/\/sessions\/current(\/|$)/.test(path)) return path;
  if (currentSession === undefined) throw new Error("No chat session in this browser context yet: open the chat first");
  return path.replace(/\/sessions\/current(\/|$)/, `/sessions/${currentSession}$1`);
}

export async function callApi(backendUrl: string, call: ApiCall): Promise<ApiResult> {
  if (!call.path.startsWith(`${API_PREFIX}/`)) throw new Error(`api paths start with ${API_PREFIX}/`);
  const url = new URL(call.path, "http://backend.invalid");
  const relative = url.pathname.slice(API_PREFIX.length);
  const route = ROUTES.find((candidate) => candidate.method === call.method && candidate.pattern.test(relative));
  if (route === undefined) {
    throw new Error(`packages/client has no ${call.method} ${url.pathname}; known routes: ${KNOWN_ROUTES.join(", ")}`);
  }
  const client = new ApiClient({ baseUrl: backendUrl });
  try {
    const body = await route.handle(client, relative.match(route.pattern) ?? [], url, call.body);
    return { ok: true, method: call.method, route: route.route, status: 200, body };
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return { ok: false, method: call.method, route: route.route, status: error.status, body: null, error: { code: error.code, message: error.message } };
    }
    throw error;
  }
}

// Expectations on a response body.

export interface ApiExpectation {
  /** Dot path into the body; `[*]` maps over an array, e.g. `spans[*].name`. Empty for the body itself. */
  readonly path: string;
  readonly equals?: unknown;
  readonly includes?: unknown;
  readonly atLeast?: number;
  readonly length?: number;
}

const EXPECTATION_FIELDS = ["path", "equals", "includes", "atLeast", "length"];

export function valueAt(body: unknown, path: string): unknown {
  if (path === "") return body;
  let values: unknown[] = [body];
  let mapped = false;
  for (const segment of path.split(".")) {
    const star = segment.endsWith("[*]");
    const key = star ? segment.slice(0, -3) : segment;
    values = values.flatMap((value) => {
      const next = key === "" ? value : value !== null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
      if (!star) return [next];
      return Array.isArray(next) ? (next as unknown[]) : [];
    });
    mapped ||= star;
  }
  return mapped ? values : values[0];
}

/** Returns why the body misses the expectation, or undefined when it meets it. */
export function unmetExpectation(body: unknown, expectation: ApiExpectation): string | undefined {
  const actual = valueAt(body, expectation.path);
  const shown = (JSON.stringify(actual) ?? "undefined").slice(0, 300);
  const at = expectation.path === "" ? "the body" : expectation.path;
  if (expectation.equals !== undefined && JSON.stringify(actual) !== JSON.stringify(expectation.equals)) {
    return `${at} is ${shown}, expected ${JSON.stringify(expectation.equals)}`;
  }
  if (expectation.includes !== undefined) {
    const has = Array.isArray(actual)
      ? actual.some((item) => JSON.stringify(item) === JSON.stringify(expectation.includes))
      : typeof actual === "string" && typeof expectation.includes === "string" && actual.includes(expectation.includes);
    if (!has) return `${at} is ${shown}, expected it to include ${JSON.stringify(expectation.includes)}`;
  }
  if (expectation.length !== undefined && (!Array.isArray(actual) || actual.length !== expectation.length)) {
    return `${at} has length ${Array.isArray(actual) ? actual.length : "n/a"}, expected ${expectation.length}`;
  }
  if (expectation.atLeast !== undefined) {
    const measure = Array.isArray(actual) ? actual.length : typeof actual === "number" ? actual : Number.NaN;
    if (!(measure >= expectation.atLeast)) return `${at} is ${shown}, expected at least ${expectation.atLeast}`;
  }
  return undefined;
}

export function parseExpectations(value: unknown): ApiExpectation[] {
  const list: unknown[] = value === undefined ? [] : Array.isArray(value) ? value : [value];
  return list.map((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) throw new Error("Each api expectation is an object with a path");
    const record = item as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!EXPECTATION_FIELDS.includes(key)) throw new Error(`Unknown api expectation field: ${key}`);
    }
    if (typeof record.path !== "string") throw new Error('An api expectation needs a path ("" for the whole body)');
    if (!["equals", "includes", "atLeast", "length"].some((key) => record[key] !== undefined)) {
      throw new Error("An api expectation needs equals, includes, atLeast or length");
    }
    for (const key of ["atLeast", "length"] as const) {
      if (record[key] !== undefined && !Number.isInteger(record[key])) throw new Error(`${key} must be an integer`);
    }
    return record as unknown as ApiExpectation;
  });
}
