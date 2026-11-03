import { routeAuth } from "eve/channels/auth";

import { ACCESS_TOKEN_AUTHENTICATOR, accessToken } from "./access-token";

// Who may read traces, context logs and transcripts: a caller signed in with an access token whose
// user id is on the operator allow-list (ERRAND_OPERATOR_IDS, comma-separated, read at each request).
// Nothing in the request body, its query or a header the client chooses can make a caller an
// operator, and the local-dev stand-in never is one: it is the person using the app.

interface Caller {
  readonly authenticator: string;
  readonly principalId: string;
}

function operatorIds(): ReadonlySet<string> {
  return new Set(
    (process.env.ERRAND_OPERATOR_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

/** True for an access-token caller whose user id is on the allow-list. */
export function isOperator(caller: Caller): boolean {
  return caller.authenticator === ACCESS_TOKEN_AUTHENTICATOR && operatorIds().has(caller.principalId);
}

/** The operator making the request, or undefined for anyone else (who must get a 404). */
export async function operatorOf(request: Request): Promise<string | undefined> {
  const caller = await routeAuth(request, [accessToken()]);
  if (caller instanceof Response || !isOperator(caller)) return undefined;
  return caller.principalId;
}
