"use client";

import type { AppApi } from "@errand/client";
import { motion } from "motion/react";
import { ArrowLeft, Check, LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { Presence, useLimeTiming, useWideScreen } from "@/components/layout-motion";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button, focusRing } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { isDemo } from "@/features/chat/backend";
import { TracePanel } from "@/features/trace-panel/trace-panel";
import { cn } from "@/lib/utils";

import { AccessLog } from "./access-log";
import { useOperatorAccess } from "./operator-access";
import { OperatorSignIn } from "./operator-sign-in";
import { SessionList } from "./session-list";
import { Transcript } from "./transcript";
import { useOperatorRead, type OperatorRead } from "./use-operator-read";

// The operator console (ticket 19): /ops lists sessions, /ops/sessions/[id] shows one read-only, the
// transcript beside the run trace and context log, with the session's operator access log. The trace rail
// exists only here; the person's chat shows none of it. v3's Operator console: a header with a Trace chip
// that collapses the rail (its width closes over --dur-base and the transcript reflows), and no glow
// anywhere, since an internal tool has no next step for the person.

const LIST_POLL_MS = 5_000;
const SESSION_POLL_MS = 2_000;

function Shell({
  title,
  back,
  onSignOut,
  tools,
  children,
}: {
  readonly title: ReactNode;
  readonly back?: boolean;
  readonly onSignOut: () => void;
  /** Header controls for the page, before the theme toggle. */
  readonly tools?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-page">
      <header className="flex h-12 items-center gap-2 border-b border-line bg-page px-3">
        {back === true && (
          <Button asChild size="sm" variant="ghost">
            <Link href="/ops">
              <ArrowLeft />
              All sessions
            </Link>
          </Button>
        )}
        <h1 className="m-0 flex min-w-0 items-center gap-2 truncate text-sm font-medium text-fg">
          <ShieldCheck aria-hidden className="size-4 shrink-0 text-fg-3" />
          {title}
        </h1>
        <div className="ml-auto flex items-center gap-1">
          {tools}
          <ThemeToggle />
          {!isDemo && (
            <Button size="sm" variant="ghost" onClick={onSignOut}>
              <LogOut />
              Sign out
            </Button>
          )}
        </div>
      </header>
      {isDemo && <DemoOperatorNote />}
      {children}
    </div>
  );
}

/**
 * Demo mode opens the console without a token, so it says what it is showing: recorded sessions, not
 * live ones, and no operator check (the real console needs a signed operator token; see the README).
 */
function DemoOperatorNote() {
  return (
    <p role="note" className="m-0 border-b border-line bg-surface px-4 py-2 text-xs text-fg-2">
      <span className="font-medium text-fg">Demo: operator view.</span> No sign-in here. The sessions are recorded runs of the real
      backend: the committed timeout-after-success trace and the chat this demo replays. The real console needs an operator token.
    </p>
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

/** The console's loading frame, also the page's Suspense fallback, so the swap moves nothing. */
export function OperatorConsoleLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center text-fg-3">
      <Spinner aria-label="Loading" />
    </div>
  );
}

function SessionsView({ api, onSignOut, onRefused }: { readonly api: AppApi; readonly onSignOut: () => void; readonly onRefused: () => void }) {
  const sessions = useOperatorRead((signal) => api.listOperatorSessions({ signal }), "sessions", LIST_POLL_MS);
  useSignOutWhenRefused([sessions], onSignOut, onRefused);
  return (
    <Shell title="Operator console" onSignOut={onSignOut}>
      <main className="mx-auto grid max-w-[48rem] gap-3 px-4 pt-6 pb-10">
        <SessionList sessions={sessions} />
      </main>
    </Shell>
  );
}

/** v3's Chip as a toggle: pressed, it shows a check on the lime wash. */
function RailChip({ open, onToggle }: { readonly open: boolean; readonly onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={open}
      aria-controls="ops-rail"
      onClick={onToggle}
      className={cn(
        focusRing,
        "inline-flex h-8 items-center gap-1.5 rounded-control border border-line-strong bg-page px-3 text-sm font-medium text-fg transition-[background-color,border-color,scale] duration-(--dur-instant) ease-out hover:bg-surface active:scale-(--scale-press)",
        "aria-pressed:border-accent-line aria-pressed:bg-accent-wash",
      )}
    >
      {open && <Check aria-hidden className="size-3.5" />}
      Trace
    </button>
  );
}

/** The trace rail: a collapsing panel, by width beside the transcript and by height when stacked under it. */
function TraceRail({ api, sessionId }: { readonly api: AppApi; readonly sessionId: string }) {
  const timing = useLimeTiming();
  const wide = useWideScreen();
  return (
    <motion.div
      id="ops-rail"
      className="flex-none overflow-hidden border-line bg-surface max-lg:border-t lg:sticky lg:top-0 lg:h-[calc(100dvh-3rem)] lg:border-l"
      initial={wide ? { width: 0 } : { height: 0 }}
      animate={wide ? { width: "auto", transition: timing.arrive } : { height: "auto", transition: timing.arrive }}
      exit={wide ? { width: 0, transition: timing.leave } : { height: 0, transition: timing.leave }}
    >
      {/* The rail's content keeps its width while the rail opens, so the waterfall never rewraps. */}
      <div className="h-full w-full overflow-y-auto lg:w-[40rem]">
        <TracePanel api={api} sessionId={sessionId} />
      </div>
    </motion.div>
  );
}

function SessionView({
  api,
  sessionId,
  onSignOut,
  onRefused,
}: {
  readonly api: AppApi;
  readonly sessionId: string;
  readonly onSignOut: () => void;
  readonly onRefused: () => void;
}) {
  const transcript = useOperatorRead((signal) => api.getSessionTranscript(sessionId, { signal }), `transcript:${sessionId}`, SESSION_POLL_MS);
  const reads = useOperatorRead((signal) => api.listOperatorReads(sessionId, { signal }), `reads:${sessionId}`, SESSION_POLL_MS);
  const [railOpen, setRailOpen] = useState(true);
  useSignOutWhenRefused([transcript, reads], onSignOut, onRefused);
  return (
    <Shell
      back
      title={
        <>
          Session <span className="min-w-0 truncate font-mono text-xs font-normal text-fg-3">{sessionId}</span>
        </>
      }
      tools={<RailChip open={railOpen} onToggle={() => setRailOpen((open) => !open)} />}
      onSignOut={onSignOut}
    >
      <main className="flex flex-col lg:flex-row lg:items-start">
        <div className="grid min-w-0 flex-1 content-start gap-6 px-4 pt-4 pb-6 lg:px-6">
          <Transcript transcript={transcript} />
          <AccessLog reads={reads} />
        </div>
        <Presence>{railOpen && <TraceRail key="rail" api={api} sessionId={sessionId} />}</Presence>
      </main>
    </Shell>
  );
}

/** /ops and /ops/sessions/[id]: the sign-in form until an operator token is in the tab, then the console. */
export function OperatorConsole({ sessionId }: { readonly sessionId?: string }) {
  const access = useOperatorAccess();
  const [refused, setRefused] = useState(false);
  const markRefused = useState(() => () => setRefused(true))[0];
  if (!access.ready) return <OperatorConsoleLoading />;
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
