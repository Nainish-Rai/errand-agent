"use client";

import { ApiRequestError } from "@errand/client";
import { useEffect, useState } from "react";

// One operator read, repeated while the console is open so a running turn shows up. A 404 means the
// token isn't an operator's (the backend answers every console route that way), so the console
// signs out instead of showing an empty page.

export type OperatorRead<T> =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly data: T }
  | { readonly status: "refused" }
  | { readonly status: "failed"; readonly message: string };

export function useOperatorRead<T>(read: ((signal: AbortSignal) => Promise<T>) | undefined, key: string, pollMs: number): OperatorRead<T> {
  const [state, setState] = useState<OperatorRead<T>>({ status: "loading" });
  useEffect(() => {
    if (read === undefined) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const data = await read(controller.signal);
        if (!controller.signal.aborted) setState({ status: "ready", data });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiRequestError && error.status === 404) {
          setState({ status: "refused" });
          return;
        }
        setState({ status: "failed", message: error instanceof Error ? error.message : String(error) });
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void tick(), pollMs);
    };
    setState({ status: "loading" });
    void tick();
    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
    // `key` names what `read` reads; a new closure with the same key is the same read.
  }, [key, pollMs]);
  return state;
}
