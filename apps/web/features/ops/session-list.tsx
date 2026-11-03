"use client";

import type { OperatorSession } from "@errand/contracts";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { Presence, Reveal } from "@/components/layout-motion";
import { Spinner } from "@/components/ui/spinner";
import { errandTitle, stepLabel } from "@/features/home/errand-words";

import type { OperatorRead } from "./use-operator-read";

// Every session the backend knows an owner for, newest first. Opening one shows its transcript
// beside its trace; that read is what the access log records, not this list.

const startedFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

function SessionRow({ session }: { readonly session: OperatorSession }) {
  const title = session.errand === null ? "No errand yet" : errandTitle(session.errand);
  return (
    <Link
        className="grid gap-0.5 rounded-field px-3 py-3 transition-colors duration-(--dur-instant) ease-out hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        href={`/ops/sessions/${encodeURIComponent(session.sessionId)}`}
      >
        <span className="text-base font-medium text-fg">{title}</span>
        <span className="text-sm text-fg-3 tabular-nums">
          {session.ownerId} · {startedFormat.format(new Date(session.startedAt))} IST
          {session.errand === null ? "" : ` · ${stepLabel(session.errand.state)}`} · {session.sessionId}
        </span>
    </Link>
  );
}

export function SessionList({ sessions }: { readonly sessions: OperatorRead<readonly OperatorSession[]> }) {
  return (
    <section aria-label="Sessions" className="grid gap-2">
      <h2 className="m-0 text-lg leading-tight font-semibold text-fg">Sessions</h2>
      {sessions.status === "loading" && <Spinner aria-label="Loading sessions" />}
      {sessions.status === "failed" && (
        <p className="m-0 rounded-md bg-danger-tint px-3 py-2 text-sm" role="alert">
          Can&apos;t read the sessions: {sessions.message}
        </p>
      )}
      {sessions.status === "ready" && sessions.data.length === 0 && <EmptyState message="No sessions yet." />}
      {sessions.status === "ready" && sessions.data.length > 0 && (
        <ul aria-label="Sessions" className="m-0 flex list-none flex-col p-0 [&>li:not(:last-child)]:border-b [&>li:not(:last-child)]:border-line">
          {/* A new session arrives at the top with a 4px rise as the list polls. */}
          <Presence>
            {sessions.data.map((session) => (
              <Reveal as="li" key={session.sessionId}>
                <SessionRow session={session} />
              </Reveal>
            ))}
          </Presence>
        </ul>
      )}
    </section>
  );
}
