"use client";

import type { ApiClient } from "@errand/client";
import { ArrowLeft, LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TracePanel } from "@/features/trace-panel/trace-panel";

import { AccessLog } from "./access-log";
import { useOperatorAccess } from "./operator-access";
import { OperatorSignIn } from "./operator-sign-in";
import { SessionList } from "./session-list";
import { Transcript } from "./transcript";
import { useOperatorRead, type OperatorRead } from "./use-operator-read";

// The operator console (ticket 19): /ops lists sessions, /ops/sessions/[id] shows one read-only, the
// transcript beside the run trace and context log (the same trace panel the chat used to show), with
// the session's operator access log. The person's chat shows none of this.

const LIST_POLL_MS = 5_000;
const SESSION_POLL_MS = 2_000;

function Shell({ title, back, onSignOut, children }: { readonly title: string; readonly back?: boolean; readonly onSignOut: () => void; readonly children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-surface-canvas">
      <header className="flex items-center gap-2 border-b border-edge bg-surface-card px-3 py-2">
        {back === true && (
          <Button asChild size="sm" variant="ghost">
            <Link href="/ops">
              <ArrowLeft />
              All sessions
            </Link>
          </Button>
        )}
        <h1 className="m-0 flex min-w-0 items-center gap-2 truncate text-panel font-medium text-fg-emph">
          <ShieldCheck aria-hidden className="size-4 shrink-0 text-fg-meta" />
          {title}
        </h1>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <Button size="sm" variant="ghost" onClick={onSignOut}>
            <LogOut />
            Sign out
          </Button>
        </div>
      </header>
      {children}
    </div>
  );
}

/** Signs out when the backend refuses the token, so a stale or wrong token lands back on the form. */
function useSignOutWhenRefused(reads: readonly OperatorRead<unknown>[], signOut: () => void, onRefused: () => void) {
  const refused = reads.some((read) => read.status === "refused");
  useEffect(() => {
    if (!refused) return;
    onRefused();
    signOut();
  }, [refused, signOut, onRefused]);
}

function Waiting() {
  return (
    <div className="flex min-h-dvh items-center justify-center text-fg-meta">
      <Spinner aria-label="Loading" />
    </div>
  );
}

function SessionsView({ api, onSignOut, onRefused }: { readonly api: ApiClient; readonly onSignOut: () => void; readonly onRefused: () => void }) {
  const sessions = useOperatorRead((signal) => api.listOperatorSessions({ signal }), "sessions", LIST_POLL_MS);
  useSignOutWhenRefused([sessions], onSignOut, onRefused);
  return (
    <Shell title="Operator console" onSignOut={onSignOut}>
      <main className="mx-auto grid max-w-3xl gap-3 p-4">
        <SessionList sessions={sessions} />
      </main>
    </Shell>
  );
}

function SessionView({
  api,
  sessionId,
  onSignOut,
  onRefused,
}: {
  readonly api: ApiClient;
  readonly sessionId: string;
  readonly onSignOut: () => void;
  readonly onRefused: () => void;
}) {
  const transcript = useOperatorRead((signal) => api.getSessionTranscript(sessionId, { signal }), `transcript:${sessionId}`, SESSION_POLL_MS);
  const reads = useOperatorRead((signal) => api.listOperatorReads(sessionId, { signal }), `reads:${sessionId}`, SESSION_POLL_MS);
  useSignOutWhenRefused([transcript, reads], onSignOut, onRefused);
  return (
    <Shell back title={`Session ${sessionId}`} onSignOut={onSignOut}>
      <main className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_40rem]">
        <div className="grid content-start gap-4">
          <Transcript transcript={transcript} />
          <AccessLog reads={reads} />
        </div>
        <div className="rounded-lg border border-edge bg-background lg:sticky lg:top-3 lg:max-h-[calc(100dvh-5rem)] lg:overflow-y-auto">
          <TracePanel api={api} sessionId={sessionId} />
        </div>
      </main>
    </Shell>
  );
}

/** /ops and /ops/sessions/[id]: the sign-in form until an operator token is in the tab, then the console. */
export function OperatorConsole({ sessionId }: { readonly sessionId?: string }) {
  const access = useOperatorAccess();
  const [refused, setRefused] = useState(false);
  const markRefused = useState(() => () => setRefused(true))[0];
  if (!access.ready) return <Waiting />;
  if (access.api === undefined) {
    return (
      <OperatorSignIn
        refused={refused}
        onSignIn={(token) => {
          setRefused(false);
          access.signIn(token);
        }}
      />
    );
  }
  return sessionId === undefined ? (
    <SessionsView api={access.api} onRefused={markRefused} onSignOut={access.signOut} />
  ) : (
    <SessionView api={access.api} sessionId={sessionId} onRefused={markRefused} onSignOut={access.signOut} />
  );
}
