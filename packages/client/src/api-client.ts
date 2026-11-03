import {
  API_PREFIX,
  ApiErrorSchema,
  ApproveProposalResponseSchema,
  DeclineProposalResponseSchema,
  GetAvailabilityResponseSchema,
  GetProposalResponseSchema,
  GetSpendResponseSchema,
  ListBookingsResponseSchema,
  ListProposalsResponseSchema,
  ForgetMemoryFactResponseSchema,
  GetErrandResponseSchema,
  GetHomeSummaryResponseSchema,
  GetProviderResponseSchema,
  GetProvidersResponseSchema,
  GetSessionContextResponseSchema,
  GetSessionTraceResponseSchema,
  GetWorldFaultResponseSchema,
  InjectWorldFaultResponseSchema,
  ListActionIntentsResponseSchema,
  LoadModelScriptResponseSchema,
  SetRunLimitsResponseSchema,
  ListMemoryResponseSchema,
  MemoryFactResponseSchema,
  SeedMemoryResponseSchema,
  SwitchScenarioResponseSchema,
  type ActionIntentView,
  type ApproveProposalRequest,
  type ApproveProposalResponse,
  type BookingView,
  type DeclineProposalResponse,
  type ProposalStatus,
  type ProposalView,
  type CorrectMemoryFactRequest,
  type DraftErrandRequest,
  type GetHomeSummaryResponse,
  type ErrandView,
  type ForgetMemoryFactResponse,
  type GetSessionContextResponse,
  type GetAvailabilityResponse,
  type GetSpendResponse,
  type GetSessionTraceResponse,
  type GetWorldFaultResponse,
  type InjectWorldFaultRequest,
  type InjectWorldFaultResponse,
  type ListMemoryResponse,
  type LoadModelScriptRequest,
  type LoadModelScriptResponse,
  type MemoryFactView,
  type MemoryKey,
  type ProviderDetails,
  type SetRunLimitsRequest,
  type SetRunLimitsResponse,
  type SeedMemoryRequest,
  type SeedMemoryResponse,
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

  /** Free slots per day for today and the six days after, per provider: what the slots-per-day chart draws. */
  async getAvailability(providerIds: readonly string[]): Promise<GetAvailabilityResponse> {
    const query = new URLSearchParams({ providerIds: providerIds.join(",") });
    return await this.#request(`/availability?${query}`, { method: "GET" }, GetAvailabilityResponseSchema);
  }

  /** Spend and bookings per month, this month and the `months - 1` before it: what the spend chart draws. */
  async getSpend(months: number): Promise<GetSpendResponse> {
    const query = new URLSearchParams({ months: String(months) });
    return await this.#request(`/spend?${query}`, { method: "GET" }, GetSpendResponseSchema);
  }

  /** A provider photo's `src` (a path under the API) as a full URL on this backend. */
  photoUrl(src: string): string {
    return `${this.#baseUrl}${src}`;
  }

  /** The session's errand (details, workflow state, what is missing), or null before the first request. */
  async getErrand(sessionId: string, options: { readonly signal?: AbortSignal } = {}): Promise<ErrandView | null> {
    const body = await this.#request(
      `/sessions/${encodeURIComponent(sessionId)}/errand`,
      { method: "GET", signal: options.signal },
      GetErrandResponseSchema,
    );
    return body.errand;
  }

  /** Every home widget in one read: work in progress, what waits on the person, bookings, alerts, memory. */
  async getHomeSummary(options: { readonly signal?: AbortSignal } = {}): Promise<GetHomeSummaryResponse> {
    return await this.#request("/home", { method: "GET", signal: options.signal }, GetHomeSummaryResponseSchema);
  }

  /**
   * The home composer's chips as a new session's errand, sent before its first message so the agent
   * starts from them. Returns the errand, or null when nothing was chosen. A session that already
   * has an errand (409 `errand_exists`) or an area outside the catalog (422) throws an ApiRequestError.
   */
  async draftErrand(sessionId: string, request: DraftErrandRequest): Promise<ErrandView | null> {
    const body = await this.#request(
      `/sessions/${encodeURIComponent(sessionId)}/errand`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) },
      GetErrandResponseSchema,
    );
    return body.errand;
  }

  /** The run trace of a chat session: its spans so far (running ones included), events and totals. */
  async getSessionTrace(sessionId: string, options: { readonly signal?: AbortSignal } = {}): Promise<GetSessionTraceResponse> {
    return await this.#request(
      `/sessions/${encodeURIComponent(sessionId)}/trace`,
      { method: "GET", signal: options.signal },
      GetSessionTraceResponseSchema,
    );
  }

  /** Every model call's context in the session: what was sent against the context budget, and what was left out and why. */
  async getSessionContext(sessionId: string, options: { readonly signal?: AbortSignal } = {}): Promise<GetSessionContextResponse> {
    return await this.#request(
      `/sessions/${encodeURIComponent(sessionId)}/context`,
      { method: "GET", signal: options.signal },
      GetSessionContextResponseSchema,
    );
  }

  /**
   * What the approval card's Approve button does: approve a proposal for the fingerprint the card
   * showed. The only way a grant is created. Repeating it returns the same grant. A changed
   * proposal (409 `fingerprint_mismatch`), a declined one (409 `proposal_not_pending`) or a lapsed
   * hold (410 `hold_expired`) throws an ApiRequestError.
   */
  async approveProposal(proposalId: string, request: ApproveProposalRequest): Promise<ApproveProposalResponse> {
    return await this.#request(
      `/proposals/${encodeURIComponent(proposalId)}/approve`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) },
      ApproveProposalResponseSchema,
    );
  }

  /** The card's Decline (and Other options): nothing is booked and the hold is released. */
  async declineProposal(proposalId: string): Promise<DeclineProposalResponse> {
    return await this.#request(
      `/proposals/${encodeURIComponent(proposalId)}/decline`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      DeclineProposalResponseSchema,
    );
  }

  /** One proposal as the approval card renders it: terms, live status, fingerprint and grant. */
  async getProposal(proposalId: string, options: { readonly signal?: AbortSignal } = {}): Promise<ProposalView> {
    const body = await this.#request(
      `/proposals/${encodeURIComponent(proposalId)}`,
      { method: "GET", signal: options.signal },
      GetProposalResponseSchema,
    );
    return body.proposal;
  }

  /** The person's proposals, newest first; `pending` gives the ones waiting on them. */
  async listProposals(options: { readonly status?: ProposalStatus } = {}): Promise<readonly ProposalView[]> {
    const query = options.status === undefined ? "" : `?${new URLSearchParams({ status: options.status })}`;
    const body = await this.#request(`/proposals${query}`, { method: "GET" }, ListProposalsResponseSchema);
    return body.proposals;
  }

  /** The proposals made in one chat session, newest first. */
  async listSessionProposals(sessionId: string): Promise<readonly ProposalView[]> {
    const body = await this.#request(
      `/sessions/${encodeURIComponent(sessionId)}/proposals`,
      { method: "GET" },
      ListProposalsResponseSchema,
    );
    return body.proposals;
  }

  /** The person's bookings as the world has them, each with the proposal and grant that made it. */
  async listBookings(): Promise<readonly BookingView[]> {
    const body = await this.#request("/bookings", { method: "GET" }, ListBookingsResponseSchema);
    return body.bookings;
  }

  /** Everything remembered about the signed-in person: facts in every status, and tombstones. */
  async listMemory(options: { readonly signal?: AbortSignal } = {}): Promise<ListMemoryResponse> {
    return await this.#request("/memory", { method: "GET", signal: options.signal }, ListMemoryResponseSchema);
  }

  /** The Memory panel's Correct: supersedes the key's fact with a new value. */
  async correctMemoryFact(key: MemoryKey, request: CorrectMemoryFactRequest): Promise<MemoryFactView> {
    const body = await this.#request(
      `/memory/${encodeURIComponent(key)}`,
      { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(request) },
      MemoryFactResponseSchema,
    );
    return body.fact;
  }

  /** The Memory panel's Forget: writes a tombstone for the key. */
  async forgetMemoryFact(key: MemoryKey): Promise<ForgetMemoryFactResponse> {
    return await this.#request(`/memory/${encodeURIComponent(key)}`, { method: "DELETE" }, ForgetMemoryFactResponseSchema);
  }

  /** The Memory panel's Confirm on an inferred fact. */
  async confirmMemoryFact(factId: string): Promise<MemoryFactView> {
    const body = await this.#request(`/memory/${encodeURIComponent(factId)}/confirm`, { method: "POST" }, MemoryFactResponseSchema);
    return body.fact;
  }

  /** Dev only: replace what is remembered about the signed-in person (evals start each scenario from it). */
  async seedMemory(request: SeedMemoryRequest): Promise<SeedMemoryResponse> {
    return await this.#request(
      "/dev/memory",
      { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(request) },
      SeedMemoryResponseSchema,
    );
  }

  /** The action ledger: every booking intent of the caller, oldest first. */
  async listActionIntents(): Promise<readonly ActionIntentView[]> {
    const body = await this.#request("/action-intents", { method: "GET" }, ListActionIntentsResponseSchema);
    return body.intents;
  }

  /** The session's booking intents, oldest first; a settled one may carry a booking update (`notice`). */
  async listSessionActionIntents(sessionId: string, options: { readonly signal?: AbortSignal } = {}): Promise<readonly ActionIntentView[]> {
    const body = await this.#request(
      `/sessions/${encodeURIComponent(sessionId)}/action-intents`,
      { method: "GET", ...(options.signal === undefined ? {} : { signal: options.signal }) },
      ListActionIntentsResponseSchema,
    );
    return body.intents;
  }

  /** Dev only: load a scenario's model turns into the offline model, or unload them with `null`. */
  async loadModelScript(request: LoadModelScriptRequest): Promise<LoadModelScriptResponse> {
    return await this.#request(
      "/dev/model-script",
      { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(request) },
      LoadModelScriptResponseSchema,
    );
  }

  /** Dev only: the run budget's limits for runs that start afterwards; `null` restores the defaults. */
  async setRunLimits(request: SetRunLimitsRequest): Promise<SetRunLimitsResponse> {
    return await this.#request(
      "/dev/run-limits",
      { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(request) },
      SetRunLimitsResponseSchema,
    );
  }

  /** Dev only: the world fault in force, and how many calls a `pause_after` fault is holding. */
  async getWorldFault(): Promise<GetWorldFaultResponse> {
    return await this.#request("/dev/world-fault", { method: "GET" }, GetWorldFaultResponseSchema);
  }

  /** Dev only: make one world operation slow, throw or pause after it took effect, until the next scenario switch; `null` clears it. */
  async injectWorldFault(request: InjectWorldFaultRequest): Promise<InjectWorldFaultResponse> {
    return await this.#request(
      "/dev/world-fault",
      { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(request) },
      InjectWorldFaultResponseSchema,
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
