import {
  API_PREFIX,
  SwitchScenarioRequestSchema,
  type ApiError,
  type GetProviderResponse,
  type GetProvidersResponse,
  type SwitchScenarioResponse,
} from "@errand/contracts";
import { defineChannel, GET, POST } from "eve/channels";

import { container } from "../../src/composition/container";
import { getProviders } from "../../src/core/use-cases/get-providers";
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

    POST(`${API_PREFIX}/dev/scenario`, async (request) => {
      if (!isDevelopment()) return failure(404, "not_found", "Dev routes are off in production.");
      const parsed = SwitchScenarioRequestSchema.safeParse(await request.json().catch(() => undefined));
      if (!parsed.success) return failure(400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid body.");
      const body: SwitchScenarioResponse = container().switchScenario(parsed.data);
      return Response.json(body);
    }),
  ],
});
