import {
  API_PREFIX,
  ApproveProposalRequestSchema,
  InjectWorldFaultRequestSchema,
  CorrectMemoryFactRequestSchema,
  DraftErrandRequestSchema,
  LoadModelScriptRequestSchema,
  ProposalStatusSchema,
  MemoryKeySchema,
  NOT_IMPLEMENTED_ERROR_CODE,
  SeedMemoryRequestSchema,
  SessionIdSchema,
  SetRunLimitsRequestSchema,
  SwitchScenarioRequestSchema,
  type ApiError,
  type ApproveProposalResponse,
  type DeclineProposalResponse,
  type GetProposalResponse,
  type ListBookingsResponse,
  type ListProposalsResponse,
  type ForgetMemoryFactResponse,
  type MemoryFactResponse,
  type SeedMemoryResponse,
  type GetErrandResponse,
  type GetProviderResponse,
  type GetProvidersResponse,
  type InjectWorldFaultResponse,
  type LoadModelScriptResponse,
  type SetRunLimitsResponse,
  type SwitchScenarioResponse,
} from "@errand/contracts";
import { defineChannel, DELETE, GET, PATCH, POST, PUT } from "eve/channels";
import { localDev, routeAuth } from "eve/channels/auth";

import { container } from "../../src/composition/container";
import { approveProposal } from "../../src/core/use-cases/approve-proposal";
import { declineProposal } from "../../src/core/use-cases/decline-proposal";
import { confirmInferredFact } from "../../src/core/use-cases/confirm-inferred-fact";
import { correctMemoryFact } from "../../src/core/use-cases/correct-memory-fact";
import { forgetMemoryFact } from "../../src/core/use-cases/forget-memory-fact";
import { draftErrand } from "../../src/core/use-cases/draft-errand";
import { getErrand } from "../../src/core/use-cases/get-errand";
import { getHomeSummary } from "../../src/core/use-cases/get-home-summary";
import { listMemoryFacts } from "../../src/core/use-cases/list-memory-facts";
import { seedMemory } from "../../src/core/use-cases/seed-memory";
import { getProviders } from "../../src/core/use-cases/get-providers";
import { getSessionContext } from "../../src/core/use-cases/get-session-context";
import { getSessionTrace } from "../../src/core/use-cases/get-session-trace";
import { listBookings } from "../../src/core/use-cases/list-bookings";
import { getProposal, listProposals } from "../../src/core/use-cases/list-proposals";
import { presentBooking, presentProposalView } from "../lib/approval-presenter";
import { appUserOf } from "../lib/app-user";
import { presentErrand } from "../lib/errand-presenter";
import { draftOf, presentDraftRefusal, presentHomeSummary } from "../lib/home-presenter";
import { memoryOwnerOfRequest } from "../lib/memory-owner";
import { presentConfirmOutcome, presentCorrectOutcome, presentFact, presentMemory, presentTombstone } from "../lib/memory-presenter";
import { presentSessionContext } from "../lib/context-presenter";
import { presentSessionTrace } from "../lib/trace-presenter";
import { presentProviderDetails } from "../lib/world-presenter";

// The app API: everything a client needs besides chat, at /api/v1 on the same origin as /eve/v1.
// Handlers stay humble: parse the request, call a use case, present the result.

const MAX_PROVIDER_IDS = 20;

function failure(status: number, code: string, message: string): Response {
  const body: ApiError = { error: { code, message } };
  return Response.json(body, { status });
}

function isDevelopment(): boolean {
  return process.env.NODE_ENV !== "production";
}

/**
 * The caller, from the channel's auth context (the same walk the chat channel uses), never from the
 * body. A Response means the caller isn't authenticated and is the answer to send.
 */
async function callerOf(request: Request): Promise<string | Response> {
  const auth = await routeAuth(request, [localDev()]);
  if (auth instanceof Response) return auth;
  return appUserOf(auth) ?? failure(401, "unauthorized", "Sign in first.");
}

function invalidBody(issues: readonly { readonly message: string }[]): Response {
  return failure(400, "invalid_request", issues[0]?.message ?? "Invalid body.");
}

export default defineChannel({
  cors: true,
  routes: [
    GET(`${API_PREFIX}/providers`, async (request) => {
      const ids = (new URL(request.url).searchParams.get("ids") ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      if (ids.length === 0) return failure(400, "missing_ids", "Pass ?ids=<id>,<id>.");
      if (ids.length > MAX_PROVIDER_IDS) {
        return failure(400, "too_many_ids", `Ask for at most ${MAX_PROVIDER_IDS} providers.`);
      }
      const providers = await getProviders(container().world, ids);
      const body: GetProvidersResponse = { providers: providers.map(presentProviderDetails) };
      return Response.json(body);
    }),

    GET(`${API_PREFIX}/providers/:providerId`, async (_request, { params }) => {
      const [provider] = await getProviders(container().world, [params.providerId ?? ""]);
      if (provider === undefined) return failure(404, "provider_not_found", "No provider has that id.");
      const body: GetProviderResponse = { provider: presentProviderDetails(provider) };
      return Response.json(body);
    }),

    // The trace panel polls this while a run is going; a session with no trace yet reads as empty.
    GET(`${API_PREFIX}/sessions/:sessionId/trace`, async (_request, { params }) => {
      const sessionId = SessionIdSchema.safeParse(params.sessionId);
      if (!sessionId.success) return failure(400, "invalid_session_id", "Pass an eve session id.");
      const trace = await getSessionTrace(container().traceSink, sessionId.data);
      // The spans are stamped with the wall clock, so "now" must be too: a pinned clock here made
      // running spans look as long as the pin's offset from today.
      return Response.json(presentSessionTrace(trace, container().wallClock.now().getTime()));
    }),

    // The context log: every model call's context against the budget, and what was left out and why.
    GET(`${API_PREFIX}/sessions/:sessionId/context`, async (_request, { params }) => {
      const sessionId = SessionIdSchema.safeParse(params.sessionId);
      if (!sessionId.success) return failure(400, "invalid_session_id", "Pass an eve session id.");
      return Response.json(presentSessionContext(await getSessionContext(container().traceSink, sessionId.data)));
    }),

    // The session's errand: its details, workflow state and what is still missing. Null before
    // the person has asked for anything.
    GET(`${API_PREFIX}/sessions/:sessionId/errand`, async (_request, { params }) => {
      const sessionId = SessionIdSchema.safeParse(params.sessionId);
      if (!sessionId.success) return failure(400, "invalid_session_id", "Pass an eve session id.");
      const { errands, catalog } = container();
      const errand = await getErrand(errands, sessionId.data);
      const body: GetErrandResponse = { errand: errand === undefined ? null : presentErrand(errand, catalog) };
      return Response.json(body);
    }),

    // GetHomeSummary: every home widget in one call. The person is the auth context's, for both
    // the world's bookings and memory. Clients poll it (see apps/web/features/home).
    GET(`${API_PREFIX}/home`, async (request) => {
      const userId = await callerOf(request);
      if (userId instanceof Response) return userId;
      const ownerId = await memoryOwnerOfRequest(request);
      if (ownerId instanceof Response) return ownerId;
      const { homeDependencies, mainModel, wallClock } = container();
      const summary = await getHomeSummary(homeDependencies, { userId, ownerId });
      return Response.json(presentHomeSummary(summary, mainModel, wallClock.now().getTime()));
    }),

    // DraftErrand: the home composer's chips become the new session's errand before its first
    // message, so the agent starts from them. An empty draft leaves the errand to the conversation.
    POST(`${API_PREFIX}/sessions/:sessionId/errand`, async (request, { params }) => {
      const userId = await callerOf(request);
      if (userId instanceof Response) return userId;
      const sessionId = SessionIdSchema.safeParse(params.sessionId);
      if (!sessionId.success) return failure(400, "invalid_session_id", "Pass an eve session id.");
      const parsed = DraftErrandRequestSchema.safeParse(await request.json().catch(() => undefined));
      if (!parsed.success) return invalidBody(parsed.error.issues);
      const { draftErrandDependencies, catalog } = container();
      const outcome = await draftErrand(draftErrandDependencies, {
        place: { traceId: sessionId.data, sessionId: sessionId.data },
        draft: draftOf(parsed.data),
      });
      if (outcome.kind === "drafted" || outcome.kind === "empty_draft") {
        const body: GetErrandResponse = { errand: outcome.kind === "drafted" ? presentErrand(outcome.errand, catalog) : null };
        return Response.json(body);
      }
      const refusal = presentDraftRefusal(outcome);
      return failure(refusal.status, refusal.code, refusal.message);
    }),

    // Memory: the person's own facts, read from the channel's auth context, never from the body.
    // A click here is a user action, so it needs no quote; it is still refused if core says no.
    GET(`${API_PREFIX}/memory`, async (request) => {
      const ownerId = await memoryOwnerOfRequest(request);
      if (ownerId instanceof Response) return ownerId;
      return Response.json(presentMemory(await listMemoryFacts(container().memory, ownerId)));
    }),

    PATCH(`${API_PREFIX}/memory/:key`, async (request, { params }) => {
      const ownerId = await memoryOwnerOfRequest(request);
      if (ownerId instanceof Response) return ownerId;
      const key = MemoryKeySchema.safeParse(params.key);
      if (!key.success) return failure(404, "unknown_memory_key", "No memory key has that name.");
      const parsed = CorrectMemoryFactRequestSchema.safeParse(await request.json().catch(() => undefined));
      if (!parsed.success) return invalidBody(parsed.error.issues);
      const outcome = await correctMemoryFact(container().memoryDependencies, {
        ownerId,
        key: key.data,
        value: parsed.data.value,
        evidence: { kind: "user_action", action: "correct" },
      });
      if (outcome.kind === "corrected" || outcome.kind === "unchanged") {
        const body: MemoryFactResponse = { fact: presentFact(outcome.fact) };
        return Response.json(body);
      }
      const status = outcome.kind === "not_found" ? 404 : 422;
      return failure(status, outcome.kind, presentCorrectOutcome(outcome).message);
    }),

    DELETE(`${API_PREFIX}/memory/:key`, async (request, { params }) => {
      const ownerId = await memoryOwnerOfRequest(request);
      if (ownerId instanceof Response) return ownerId;
      const key = MemoryKeySchema.safeParse(params.key);
      if (!key.success) return failure(404, "unknown_memory_key", "No memory key has that name.");
      const outcome = await forgetMemoryFact(container().memoryDependencies, {
        ownerId,
        key: key.data,
        evidence: { kind: "user_action", action: "forget" },
      });
      if (outcome.kind === "untrusted_source") return failure(403, outcome.kind, "Only you can make the agent forget.");
      const body: ForgetMemoryFactResponse = { tombstone: presentTombstone(outcome.tombstone) };
      return Response.json(body);
    }),

    POST(`${API_PREFIX}/memory/:factId/confirm`, async (request, { params }) => {
      const ownerId = await memoryOwnerOfRequest(request);
      if (ownerId instanceof Response) return ownerId;
      const outcome = await confirmInferredFact(container().memoryDependencies, {
        ownerId,
        fact: { id: params.factId ?? "" },
        evidence: { kind: "user_action", action: "confirm" },
      });
      if (outcome.kind === "confirmed") {
        const body: MemoryFactResponse = { fact: presentFact(outcome.fact) };
        return Response.json(body);
      }
      const status = outcome.kind === "not_found" ? 404 : 409;
      return failure(status, outcome.kind, presentConfirmOutcome(outcome).message);
    }),

    // The approval card's button, and the only way a grant is ever created: ApproveProposal has no
    // other caller (dependency-cruiser enforces it). The person comes from the auth context; the
    // fingerprint is the one the card showed. Idempotent: a repeated click gets the same grant.
    POST(`${API_PREFIX}/proposals/:proposalId/approve`, async (request, { params }) => {
      const userId = await callerOf(request);
      if (userId instanceof Response) return userId;
      const parsed = ApproveProposalRequestSchema.safeParse(await request.json().catch(() => undefined));
      if (!parsed.success) return invalidBody(parsed.error.issues);
      const outcome = await approveProposal(
        container().proposalDependencies,
        { proposalId: params.proposalId ?? "", fingerprint: parsed.data.fingerprint, userId },
      );
      switch (outcome.kind) {
        case "approved": {
          const body: ApproveProposalResponse = {
            proposalId: outcome.proposal.proposalId,
            grantId: outcome.grant.grantId,
            expiresAt: new Date(outcome.grant.expiresAtMs).toISOString(),
          };
          return Response.json(body);
        }
        case "proposal_not_found":
          return failure(404, "proposal_not_found", "No proposal of yours has that id.");
        case "fingerprint_mismatch":
          return failure(409, "fingerprint_mismatch", "The card you approved no longer matches this proposal.");
        case "not_pending":
          return failure(409, "proposal_not_pending", `The proposal is ${outcome.status}.`);
        case "hold_expired":
          return failure(410, "hold_expired", "The hold ran out before you approved, so nothing can be booked on it.");
      }
    }),

    // Decline (and Other options) on the card: nothing is booked and the hold is released.
    POST(`${API_PREFIX}/proposals/:proposalId/decline`, async (request, { params }) => {
      const userId = await callerOf(request);
      if (userId instanceof Response) return userId;
      const outcome = await declineProposal(container().proposalDependencies, { proposalId: params.proposalId ?? "", userId });
      switch (outcome.kind) {
        case "declined": {
          const body: DeclineProposalResponse = { proposalId: outcome.proposal.proposalId, status: outcome.proposal.status };
          return Response.json(body);
        }
        case "proposal_not_found":
          return failure(404, "proposal_not_found", "No proposal of yours has that id.");
        case "too_late":
          return failure(409, "too_late", `The booking is already ${outcome.status}.`);
      }
    }),

    // ListPendingProposals ("Waiting on you"), or any status with ?status=.
    GET(`${API_PREFIX}/proposals`, async (request) => {
      const userId = await callerOf(request);
      if (userId instanceof Response) return userId;
      const statusParam = new URL(request.url).searchParams.get("status");
      const status = statusParam === null ? undefined : ProposalStatusSchema.safeParse(statusParam);
      if (status !== undefined && !status.success) return failure(400, "invalid_status", "Pass a proposal status.");
      const standings = await listProposals(container().proposalDependencies, { userId, ...(status === undefined ? {} : { status: status.data }) });
      const body: ListProposalsResponse = { proposals: standings.map(presentProposalView) };
      return Response.json(body);
    }),

    // What the approval card renders from: the proposal's terms, live status, fingerprint and grant.
    GET(`${API_PREFIX}/proposals/:proposalId`, async (request, { params }) => {
      const userId = await callerOf(request);
      if (userId instanceof Response) return userId;
      const standing = await getProposal(container().proposalDependencies, { proposalId: params.proposalId ?? "", userId });
      if (standing === undefined) return failure(404, "proposal_not_found", "No proposal of yours has that id.");
      const body: GetProposalResponse = { proposal: presentProposalView(standing) };
      return Response.json(body);
    }),

    GET(`${API_PREFIX}/sessions/:sessionId/proposals`, async (request, { params }) => {
      const userId = await callerOf(request);
      if (userId instanceof Response) return userId;
      const sessionId = SessionIdSchema.safeParse(params.sessionId);
      if (!sessionId.success) return failure(400, "invalid_session_id", "Pass an eve session id.");
      const standings = await listProposals(container().proposalDependencies, { userId, sessionId: sessionId.data });
      const body: ListProposalsResponse = { proposals: standings.map(presentProposalView) };
      return Response.json(body);
    }),

    // ListBookings: the world's bookings, each with the proposal and grant that made it.
    GET(`${API_PREFIX}/bookings`, async (request) => {
      const userId = await callerOf(request);
      if (userId instanceof Response) return userId;
      const bookings = await listBookings(container().proposalDependencies, userId);
      const body: ListBookingsResponse = { bookings: bookings.map(presentBooking) };
      return Response.json(body);
    }),

    POST(`${API_PREFIX}/dev/scenario`, async (request) => {
      if (!isDevelopment()) return failure(404, "not_found", "Dev routes are off in production.");
      const parsed = SwitchScenarioRequestSchema.safeParse(await request.json().catch(() => undefined));
      if (!parsed.success) return invalidBody(parsed.error.issues);
      const body: SwitchScenarioResponse = await container().switchScenario(parsed.data);
      return Response.json(body);
    }),

    // Evals start each scenario from the memory it declares (none by default), so one scenario's
    // remembered area can't leak into the next.
    PUT(`${API_PREFIX}/dev/memory`, async (request) => {
      if (!isDevelopment()) return failure(404, "not_found", "Dev routes are off in production.");
      const ownerId = await memoryOwnerOfRequest(request);
      if (ownerId instanceof Response) return ownerId;
      const parsed = SeedMemoryRequestSchema.safeParse(await request.json().catch(() => undefined));
      if (!parsed.success) return invalidBody(parsed.error.issues);
      const body: SeedMemoryResponse = await seedMemory(container().memoryDependencies, { ownerId, facts: parsed.data.facts });
      return Response.json(body);
    }),

    // Evals load a scenario's model turns here; the offline model plays them. `null` unloads.
    PUT(`${API_PREFIX}/dev/model-script`, async (request) => {
      if (!isDevelopment()) return failure(404, "not_found", "Dev routes are off in production.");
      const parsed = LoadModelScriptRequestSchema.safeParse(await request.json().catch(() => undefined));
      if (!parsed.success) return invalidBody(parsed.error.issues);
      const { modelScript } = container();
      if (parsed.data.script === null) modelScript.unload();
      else modelScript.load(parsed.data.script);
      const body: LoadModelScriptResponse = { loaded: parsed.data.script !== null, turns: modelScript.loadedTurns };
      return Response.json(body);
    }),

    // Evals and browser checks tighten the run budget here, for runs that start afterwards.
    PUT(`${API_PREFIX}/dev/run-limits`, async (request) => {
      if (!isDevelopment()) return failure(404, "not_found", "Dev routes are off in production.");
      const parsed = SetRunLimitsRequestSchema.safeParse(await request.json().catch(() => undefined));
      if (!parsed.success) return invalidBody(parsed.error.issues);
      const body: SetRunLimitsResponse = { limits: container().setRunLimits(parsed.data.limits) };
      return Response.json(body);
    }),

    // A slow or throwing world operation, so a scenario can prove the run stops on time and fails cleanly.
    PUT(`${API_PREFIX}/dev/world-fault`, async (request) => {
      if (!isDevelopment()) return failure(404, "not_found", "Dev routes are off in production.");
      const parsed = InjectWorldFaultRequestSchema.safeParse(await request.json().catch(() => undefined));
      if (!parsed.success) return invalidBody(parsed.error.issues);
      const body: InjectWorldFaultResponse = { fault: container().injectWorldFault(parsed.data.fault) };
      return Response.json(body);
    }),
  ],
});
