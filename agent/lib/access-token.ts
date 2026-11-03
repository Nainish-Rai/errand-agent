import { ACCESS_TOKEN_AUDIENCE, ACCESS_TOKEN_ISSUER } from "@errand/contracts";
import { extractBearerToken, UnauthenticatedError, verifyJwtHmac, withAuthChallenges, type AuthFn } from "eve/channels/auth";

// Signed-in callers other than the local-dev stand-in: an HS256 access token whose subject is the
// caller's user id, verified with ERRAND_AUTH_SECRET. The secret is read from the environment at
// each request (a keychain item or the verify/eval launcher puts it there) and never written to a
// file. Without it no token is accepted and only `localDev()` signs anyone in.
//
// eve's own jwtHmac() would make every token caller a `service`; these are people (and operators,
// who are people on the allow-list in operator.ts), so the verified subject becomes a `user`.

export const ACCESS_TOKEN_AUTHENTICATOR = "errand-access-token";

function authSecret(): string | undefined {
  const secret = process.env.ERRAND_AUTH_SECRET?.trim();
  return secret === undefined || secret === "" ? undefined : secret;
}

/**
 * The auth-walk entry for access tokens: a `user` caller, null when the request carries no token (so
 * the walk tries the next entry), and a 401 for a token that doesn't verify. A bad token never falls
 * through to the local-dev stand-in, so an expired operator token can't quietly act as the person.
 */
export function accessToken(): AuthFn<Request> {
  return withAuthChallenges(
    async (request) => {
      const secret = authSecret();
      const token = extractBearerToken(request.headers.get("authorization"));
      if (token === null) return null;
      const verified =
        secret === undefined
          ? { ok: false as const }
          : await verifyJwtHmac(token, { algorithm: "HS256", issuer: ACCESS_TOKEN_ISSUER, audiences: [ACCESS_TOKEN_AUDIENCE], secret });
      const subject = verified.ok ? verified.sessionAuth.subject : undefined;
      if (subject === undefined || subject === "") {
        throw new UnauthenticatedError({ code: "invalid_token", message: "The access token isn't valid.", challenges: [{ scheme: "Bearer" }] });
      }
      return {
        attributes: {},
        authenticator: ACCESS_TOKEN_AUTHENTICATOR,
        issuer: ACCESS_TOKEN_ISSUER,
        principalId: subject,
        principalType: "user",
        subject,
      };
    },
    [{ scheme: "Bearer" }],
  );
}
