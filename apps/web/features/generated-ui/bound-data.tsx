"use client";

import { useAuiState } from "@assistant-ui/react";
import { providersShownBySearch, type ApiClient } from "@errand/client";
import type { BookingView, ErrandView, GetAvailabilityResponse, GetSpendResponse, ProviderDetails } from "@errand/contracts";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

// What generated components read the world through: the app API client (read-only routes only)
// and a way to answer as the person. Every price, rating, slot, status and chart value comes from
// these reads by id, never from the program the model wrote.

export interface GeneratedUiHost {
  readonly api: ApiClient;
  /** Sends text as the person's next message: the only thing a generated button can do. */
  readonly send: (text: string) => Promise<void>;
  readonly sessionId: string;
}

const HostContext = createContext<GeneratedUiHost | undefined>(undefined);

export function GeneratedUiHostProvider({ host, children }: { readonly host: GeneratedUiHost; readonly children: ReactNode }) {
  return <HostContext.Provider value={host}>{children}</HostContext.Provider>;
}

export function useGeneratedUiHost(): GeneratedUiHost {
  const host = useContext(HostContext);
  if (host === undefined) throw new Error("Generated UI needs a GeneratedUiHostProvider above it.");
  return host;
}

/** The providers this reply's search_providers already shows as cards (see packages/client repeats.ts). */
export function useProvidersShownBySearch(): ReadonlySet<string> {
  const parts = useAuiState((state) => state.message.parts);
  return useMemo(
    () =>
      providersShownBySearch(
        parts.flatMap((part) => (part.type === "tool-call" && part.toolName === "search_providers" && part.result !== undefined ? [part.result] : [])),
      ),
    [parts],
  );
}

export type Loaded<T> = { readonly status: "loading" } | { readonly status: "failed" } | { readonly status: "ready"; readonly data: T };

/** Reads once per key; a new key reads again. */
function useRead<T>(key: string, read: () => Promise<T>): Loaded<T> {
  const [state, setState] = useState<{ readonly key: string; readonly loaded: Loaded<T> }>({ key, loaded: { status: "loading" } });
  useEffect(() => {
    let live = true;
    read().then(
      (data) => live && setState({ key, loaded: { status: "ready", data } }),
      () => live && setState({ key, loaded: { status: "failed" } }),
    );
    return () => {
      live = false;
    };
    // `read` closes over the same inputs as `key`.
  }, [key]);
  return state.key === key ? state.loaded : { status: "loading" };
}

export function useProviders(providerIds: readonly string[]): Loaded<readonly ProviderDetails[]> {
  const { api } = useGeneratedUiHost();
  const ids = [...new Set(providerIds)];
  return useRead(`providers:${ids.join(",")}`, () => (ids.length === 0 ? Promise.resolve([]) : api.getProviders(ids)));
}

export function useAvailability(providerIds: readonly string[]): Loaded<GetAvailabilityResponse> {
  const { api } = useGeneratedUiHost();
  return useRead(`availability:${providerIds.join(",")}`, () => api.getAvailability(providerIds));
}

export function useSpend(months: number): Loaded<GetSpendResponse> {
  const { api } = useGeneratedUiHost();
  return useRead(`spend:${months}`, () => api.getSpend(months));
}

export function useBookings(): Loaded<readonly BookingView[]> {
  const { api } = useGeneratedUiHost();
  return useRead("bookings", () => api.listBookings());
}

export function useErrand(): Loaded<ErrandView | null> {
  const { api, sessionId } = useGeneratedUiHost();
  return useRead(`errand:${sessionId}`, () => api.getErrand(sessionId));
}
