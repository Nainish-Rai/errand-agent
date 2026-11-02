import type { BrowserContext } from "playwright-core";

// A driven browser reaches only its own run: the web and backend origins on 127.0.0.1. Two layers:
//   1. every request in a context is routed; anything else is aborted before it leaves the browser
//      and logged as `network-guard-blocked`;
//   2. Chrome's resolver maps every other host name to NOTFOUND, which also covers what the route
//      layer cannot see (WebSockets, the browser's own background requests).
// Service workers are blocked in every context so no request can bypass the route.

export interface GuardEvent {
  readonly type: "network-guard-blocked";
  readonly url: string;
  readonly method: string;
  readonly resourceType: string;
  readonly navigation: boolean;
  /** True for the doctor's own probe, which must be blocked; anything else blocked is a finding. */
  readonly probe: boolean;
}

/** The doctor requests this to prove the guard; it must appear as blocked. */
export const GUARD_PROBE_URL = "https://example.com/errand-verify-guard-probe";

/** Origin and path only: never a query string or fragment, which can carry values. */
export function cleanUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return url.protocol === "data:" || url.protocol === "blob:" ? `${url.protocol}…` : `${url.origin}${url.pathname}`;
  } catch {
    return String(raw).split(/[?#]/)[0] ?? "";
  }
}

export function runOrigins(ports: readonly number[]): Set<string> {
  return new Set(ports.flatMap((port) => [`http://127.0.0.1:${port}`, `http://localhost:${port}`]));
}

/** True only for a request to one of the run's own origins (or an inline data/blob URL). */
export function isAllowed(raw: string, origins: ReadonlySet<string>): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol === "data:" || url.protocol === "blob:") return true;
    return origins.has(url.origin);
  } catch {
    return false;
  }
}

/** Chrome arguments: no name resolves except loopback, and no background networking. */
export function guardLaunchArgs(): string[] {
  return [
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
    "--disable-background-networking",
    "--disable-component-update",
    "--no-pings",
  ];
}

export async function installNetworkGuard(
  context: BrowserContext,
  origins: ReadonlySet<string>,
  log: (event: GuardEvent) => void,
): Promise<{ readonly installed: true }> {
  await context.route(
    () => true,
    async (route) => {
      const request = route.request();
      if (isAllowed(request.url(), origins)) {
        await route.fallback();
        return;
      }
      try {
        log({
          type: "network-guard-blocked",
          url: cleanUrl(request.url()),
          method: request.method(),
          resourceType: request.resourceType(),
          navigation: request.isNavigationRequest(),
          probe: cleanUrl(request.url()) === GUARD_PROBE_URL,
        });
      } finally {
        await route.abort("blockedbyclient");
      }
    },
  );
  return { installed: true };
}
