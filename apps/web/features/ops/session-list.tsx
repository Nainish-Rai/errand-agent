"use client";

import type { OperatorSession } from "@errand/contracts";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { errandTitle, stepLabel } from "@/features/home/errand-words";

import type { OperatorRead } from "./use-operator-read";

// Every session the backend knows an owner for, newest first. Opening one shows its transcript
// beside its trace; that read is what the access log records, not this list.

const startedFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

function SessionRow({ session }: { readonly session: OperatorSession }) {
  const title = session.errand === null ? "No errand yet" : errandTitle(session.errand);
  return (
    <li>
      <Link
        className="grid gap-0.5 rounded-md border border-line bg-surface px-3 py-2 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        href={`/ops/sessions/${encodeURIComponent(session.sessionId)}`}
      >
        <span className="text-sm text-fg">{title}</span>
        <span className="text-xs text-fg-3 tabular-nums">
          {session.ownerId} · {startedFormat.format(new Date(session.startedAt))} IST
          {session.errand === null ? "" : ` · ${stepLabel(session.errand.state)}`} · {session.sessionId}
        </span>
      </Link>
    </li>
  );
}

export function SessionList({ sessions }: { readonly sessions: OperatorRead<readonly OperatorSession[]> }) {
  return (
    <section aria-label="Sessions" className="grid gap-2">
      <h2 className="m-0 text-xs font-normal text-fg-3">Sessions</h2>
      {sessions.status === "loading" && <Spinner aria-label="Loading sessions" />}
      {sessions.status === "failed" && (
        <p className="m-0 rounded-md bg-danger-tint px-3 py-2 text-sm" role="alert">
          Can&apos;t read the sessions: {sessions.message}
        </p>
      )}
      {sessions.status === "ready" && sessions.data.length === 0 && <EmptyState message="No sessions yet." />}
      {sessions.status === "ready" && sessions.data.length > 0 && (
        <ul aria-label="Sessions" className="m-0 grid list-none gap-1.5 p-0">
          {sessions.data.map((session) => (
            <SessionRow key={session.sessionId} session={session} />
          ))}
        </ul>
      )}
    </section>
  );
}
