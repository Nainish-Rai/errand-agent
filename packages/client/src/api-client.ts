import {
  API_PREFIX,
  ApiErrorSchema,
  GetProviderResponseSchema,
  GetProvidersResponseSchema,
  GetSessionTraceResponseSchema,
  SwitchScenarioResponseSchema,
  type GetSessionTraceResponse,
  type ProviderDetails,
  type SwitchScenarioRequest,
  type SwitchScenarioResponse,
} from "@errand/contracts";
import type { z } from "zod";

export interface ApiClientOptions {
  /** Backend origin, e.g. `http://localhost:3100`. */
  readonly baseUrl: string;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

/** Typed client for the app API at /api/v1. Every body is parsed against its contract. */
export class ApiClient {
  readonly #baseUrl: string;

  constructor(options: ApiClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/$/, "");
  }

  async getProviders(providerIds: readonly string[]): Promise<readonly ProviderDetails[]> {
    const query = new URLSearchParams({ ids: providerIds.join(",") });
    const body = await this.#request(`/providers?${query}`, { method: "GET" }, GetProvidersResponseSchema);
    return body.providers;
  }

  async getProvider(providerId: string): Promise<ProviderDetails> {
    const body = await this.#request(
      `/providers/${encodeURIComponent(providerId)}`,
      { method: "GET" },
      GetProviderResponseSchema,
    );
    return body.provider;
  }

  /** The run trace of a chat session: its spans so far (running ones included), events and totals. */
  async getSessionTrace(sessionId: string, options: { readonly signal?: AbortSignal } = {}): Promise<GetSessionTraceResponse> {
    return await this.#request(
      `/sessions/${encodeURIComponent(sessionId)}/trace`,
      { method: "GET", signal: options.signal },
      GetSessionTraceResponseSchema,
    );
  }

  /** Dev only: reseed the mock world with a named scenario. */
  async switchScenario(request: SwitchScenarioRequest): Promise<SwitchScenarioResponse> {
    return await this.#request(
      "/dev/scenario",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) },
      SwitchScenarioResponseSchema,
    );
  }

  async #request<TSchema extends z.ZodType>(path: string, init: RequestInit, schema: TSchema): Promise<z.infer<TSchema>> {
    const response = await fetch(`${this.#baseUrl}${API_PREFIX}${path}`, init);
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const failure = ApiErrorSchema.safeParse(payload);
      throw failure.success
        ? new ApiRequestError(response.status, failure.data.error.code, failure.data.error.message)
        : new ApiRequestError(response.status, "unexpected_response", `HTTP ${response.status} from ${path}`);
    }
    return schema.parse(payload);
  }
}
