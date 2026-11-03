import {
  API_PREFIX,
  ApproveProposalRequestSchema,
  InjectWorldFaultRequestSchema,
  LoadModelScriptRequestSchema,
  ProposalStatusSchema,
  SessionIdSchema,
  SetRunLimitsRequestSchema,
  SwitchScenarioRequestSchema,
  type ApiError,
  type ApproveProposalResponse,
  type DeclineProposalResponse,
  type GetProposalResponse,
  type ListBookingsResponse,
  type ListProposalsResponse,
  type GetErrandResponse,
  type GetProviderResponse,
  type GetProvidersResponse,
  type InjectWorldFaultResponse,
  type LoadModelScriptResponse,
  type SetRunLimitsResponse,
  type SwitchScenarioResponse,
} from "@errand/contracts";
import { defineChannel, GET, POST, PUT } from "eve/channels";
import { localDev, routeAuth } from "eve/channels/auth";

import { container } from "../../src/composition/container";
import { approveProposal } from "../../src/core/use-cases/approve-proposal";
import { declineProposal } from "../../src/core/use-cases/decline-proposal";
import { getErrand } from "../../src/core/use-cases/get-errand";
import { getProviders } from "../../src/core/use-cases/get-providers";
import { getSessionTrace } from "../../src/core/use-cases/get-session-trace";
import { listBookings } from "../../src/core/use-cases/list-bookings";
import { getProposal, listProposals } from "../../src/core/use-cases/list-proposals";
import { presentBooking, presentProposalView } from "../lib/approval-presenter";
import { appUserOf } from "../lib/app-user";
import { presentErrand } from "../lib/errand-presenter";
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
