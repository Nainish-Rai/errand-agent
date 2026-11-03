"use client";

import type { AppApi } from "@errand/client";
import { useCallback, useEffect, useMemo, useState } from "react";

import { isDemo, operatorApi } from "@/features/chat/backend";

// The operator's sign-in for the console: an access token the backend issues to operators (see the
// README, "Operator console"). It lives only in this tab's sessionStorage and goes to the backend as
// `Authorization: Bearer`; the backend decides whether its user id is an operator. Nothing here
// grants access: a person who reaches /ops without a valid token sees nothing but the sign-in form,
// and the API refuses them with 404 whatever the page does.

const STORAGE_KEY = "errand.operator-token";

export interface OperatorAccess {
  /** False until the tab's storage has been read, so the page doesn't flash the sign-in form. */
  readonly ready: boolean;
  /** The operator's API client, or undefined when nobody is signed in. */
  readonly api: AppApi | undefined;
  signIn(token: string): void;
  signOut(): void;
}

export function useOperatorAccess(): OperatorAccess {
  const [token, setToken] = useState<string>();
  const [ready, setReady] = useState(false);
  // Demo mode has no backend to refuse anyone: the console opens on its recorded sessions, labelled as a demo.
  const demoApi = useMemo(() => (isDemo ? operatorApi("") : undefined), []);

  useEffect(() => {
    setToken(window.sessionStorage.getItem(STORAGE_KEY) ?? undefined);
    setReady(true);
  }, []);

  const signIn = useCallback((next: string) => {
    window.sessionStorage.setItem(STORAGE_KEY, next);
    setToken(next);
  }, []);

  const signOut = useCallback(() => {
    window.sessionStorage.removeItem(STORAGE_KEY);
    setToken(undefined);
  }, []);

  const api = useMemo(() => (token === undefined ? undefined : operatorApi(token)), [token]);
  if (demoApi !== undefined) return { ready: true, api: demoApi, signIn, signOut };
  return { ready, api, signIn, signOut };
}
