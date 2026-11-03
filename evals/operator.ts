import { randomBytes } from "node:crypto";

import { ApiClient, mintAccessToken } from "@errand/client";

// Callers other than the person, for the evals (ticket 19). The backend accepts access tokens signed
// with ERRAND_AUTH_SECRET, and only a token whose user id is on ERRAND_OPERATOR_IDS may read traces
// and context logs. The eval run makes up a secret of its own (never stored anywhere) and gives it to
// the backend through the environment, the same way it pins the clock.

/** The operator the evals read traces as. */
export const EVAL_OPERATOR_ID = "eval-operator";
/** A second person, who must never see the first person's sessions. */
export const EVAL_OTHER_PERSON_ID = "eval-other-person";

export interface AuthEnvironment {
  readonly ERRAND_AUTH_SECRET: string;
  readonly ERRAND_OPERATOR_IDS: string;
}

/**
 * The backend's auth settings for this eval run: the secret already in the environment (so the
 * eval config and the scenarios agree on it), or a fresh random one for the config to set.
 */
export function authEnvironment(environment: Readonly<Record<string, string | undefined>> = process.env): AuthEnvironment {
  const secret = environment.ERRAND_AUTH_SECRET?.trim();
  return {
    ERRAND_AUTH_SECRET: secret === undefined || secret === "" ? randomBytes(32).toString("hex") : secret,
    ERRAND_OPERATOR_IDS: EVAL_OPERATOR_ID,
  };
}

async function clientFor(baseUrl: string, subject: string): Promise<ApiClient> {
  const secret = process.env.ERRAND_AUTH_SECRET;
  if (secret === undefined || secret === "") throw new Error("ERRAND_AUTH_SECRET is unset: the eval config sets it before the backend starts.");
  return new ApiClient({ baseUrl, accessToken: await mintAccessToken({ secret, subject }) });
}

/** The app API as the evals' operator: traces, context logs, the console's routes. */
export function operatorClient(baseUrl: string): Promise<ApiClient> {
  return clientFor(baseUrl, EVAL_OPERATOR_ID);
}

/** The app API as a second person, signed in with their own token. */
export function otherPersonClient(baseUrl: string): Promise<ApiClient> {
  return clientFor(baseUrl, EVAL_OTHER_PERSON_ID);
}
