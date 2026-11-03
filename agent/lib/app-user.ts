import { container } from "../../src/composition/container";

// Who the caller is, from the channel's auth context and never from a request body or a model
// argument. Locally every caller is eve's `local-dev` principal, which is the world's one dev
// user. Real auth changes only this mapping.

interface Principal {
  readonly principalId: string;
  readonly principalType: string;
}

/** The app's user id for an authenticated principal, or undefined when there is no principal. */
export function appUserOf(principal: Principal | null | undefined): string | undefined {
  if (principal === null || principal === undefined) return undefined;
  return principal.principalType === "local-dev" ? container().devUserId : principal.principalId;
}
