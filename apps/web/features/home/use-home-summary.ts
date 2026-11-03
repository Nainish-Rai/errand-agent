"use client";

import type { GetHomeSummaryResponse } from "@errand/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { appApi } from "@/features/chat/backend";

// The home screen's data: GET /api/v1/home, polled. The backend has no event stream yet (the
// /events route is planned with ticket 14's alerts), so the widgets refresh every few seconds, at
// once when the tab comes back into view, and right after the person changes something.

export const HOME_POLL_MS = 5_000;

export interface HomeSummaryState {
  readonly summary?: GetHomeSummaryResponse;
  /** Set when the last refresh failed; the last good summary stays on screen. */
  readonly error?: string;
  readonly refresh: () => void;
}

export function useHomeSummary(): HomeSummaryState {
  const [summary, setSummary] = useState<GetHomeSummaryResponse>();
  const [error, setError] = useState<string>();
  const refreshNow = useRef<() => void>(() => undefined);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      clearTimeout(timer);
      try {
        setSummary(await appApi.getHomeSummary({ signal: controller.signal }));
        setError(undefined);
      } catch (failure) {
        if (controller.signal.aborted) return;
        setError(failure instanceof Error ? failure.message : String(failure));
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), HOME_POLL_MS);
    };
    refreshNow.current = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const refresh = useCallback(() => refreshNow.current(), []);
  return { summary, error, refresh };
}
