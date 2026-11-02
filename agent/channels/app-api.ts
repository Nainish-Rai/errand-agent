import {
  API_PREFIX,
  ApproveProposalRequestSchema,
  LoadModelScriptRequestSchema,
  NOT_IMPLEMENTED_ERROR_CODE,
  SessionIdSchema,
  SwitchScenarioRequestSchema,
  type ApiError,
  type GetProviderResponse,
  type GetProvidersResponse,
  type LoadModelScriptResponse,
  type SwitchScenarioResponse,
} from "@errand/contracts";
import { defineChannel, GET, POST, PUT } from "eve/channels";

import { container } from "../../src/composition/container";
import { getProviders } from "../../src/core/use-cases/get-providers";
import { getSessionTrace } from "../../src/core/use-cases/get-session-trace";
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
      return Response.json(presentSessionTrace(trace, container().clock.now().getTime()));
    }),

    // The approval card's button, and the only way a grant will ever be created. The body is
    // checked now so clients and the eval harness are held to the contract; ApproveProposal
    // itself arrives with ticket 05.
    POST(`${API_PREFIX}/proposals/:proposalId/approve`, async (request) => {
      const parsed = ApproveProposalRequestSchema.safeParse(await request.json().catch(() => undefined));
      if (!parsed.success) return invalidBody(parsed.error.issues);
      return failure(501, NOT_IMPLEMENTED_ERROR_CODE, "Approving a proposal arrives with ticket 05.");
    }),

    POST(`${API_PREFIX}/dev/scenario`, async (request) => {
      if (!isDevelopment()) return failure(404, "not_found", "Dev routes are off in production.");
      const parsed = SwitchScenarioRequestSchema.safeParse(await request.json().catch(() => undefined));
      if (!parsed.success) return invalidBody(parsed.error.issues);
      const body: SwitchScenarioResponse = container().switchScenario(parsed.data);
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
  ],
});
