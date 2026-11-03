import { ACCESS_TOKEN_AUDIENCE, ACCESS_TOKEN_ISSUER } from "@errand/contracts";

// Signs an access token the backend accepts: HS256 over ERRAND_AUTH_SECRET, the caller's user id as
// its subject. Only tools that hold the secret use it (the evals, the verify CLI, the operator-token
// script); an app never ships the secret. Web Crypto only, so it runs in Node and in a browser alike.

const DEFAULT_LIFETIME_SECONDS = 12 * 60 * 60;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

export async function mintAccessToken(options: {
  readonly secret: string;
  /** The caller's user id. An operator is a user id on the backend's ERRAND_OPERATOR_IDS. */
  readonly subject: string;
  readonly lifetimeSeconds?: number;
  readonly nowMs?: number;
}): Promise<string> {
  const issuedAt = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const payload = {
    iss: ACCESS_TOKEN_ISSUER,
    aud: ACCESS_TOKEN_AUDIENCE,
    sub: options.subject,
    iat: issuedAt,
    exp: issuedAt + (options.lifetimeSeconds ?? DEFAULT_LIFETIME_SECONDS),
  };
  const signingInput = `${base64UrlJson({ alg: "HS256", typ: "JWT" })}.${base64UrlJson(payload)}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(options.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput)));
  return `${signingInput}.${base64Url(signature)}`;
}
