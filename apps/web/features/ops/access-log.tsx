"use client";

import type { ListOperatorReadsResponse, OperatorReadKind } from "@errand/contracts";

import { Spinner } from "@/components/ui/spinner";

import type { OperatorRead } from "./use-operator-read";

// The audit of this session's operator reads: who read its trace, context log and transcript, how
// often and when. Opening this page is itself a read, so the operator always sees their own entry.

const KINDS: Readonly<Record<OperatorReadKind, string>> = { trace: "Run trace", context: "Context log", transcript: "Transcript" };

const timeFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

function at(iso: string): string {
  return `${timeFormat.format(new Date(iso))} IST`;
}

export function AccessLog({ reads }: { readonly reads: OperatorRead<ListOperatorReadsResponse> }) {
  return (
    <section aria-label="Operator access log" className="grid content-start gap-2">
      <h2 className="m-0 text-label font-normal text-fg-meta">Operator access log</h2>
      {reads.status === "loading" && <Spinner aria-label="Loading the access log" />}
      {reads.status === "failed" && (
        <p className="m-0 rounded-md bg-err-tint px-3 py-2 text-body" role="alert">
          Can&apos;t read the access log: {reads.message}
        </p>
      )}
      {reads.status === "ready" && reads.data.reads.length === 0 && <p className="m-0 text-body text-fg-meta">No operator has read this session.</p>}
      {reads.status === "ready" && reads.data.reads.length > 0 && (
        <table className="w-full border-collapse text-left text-body">
          <thead className="text-label text-fg-meta">
            <tr>
              <th className="py-1 pr-2 font-normal" scope="col">Operator</th>
              <th className="py-1 pr-2 font-normal" scope="col">Read</th>
              <th className="py-1 pr-2 text-right font-normal" scope="col">Times</th>
              <th className="py-1 font-normal" scope="col">Last read</th>
            </tr>
          </thead>
          <tbody className="text-fg-body">
            {reads.data.reads.map((read) => (
              <tr className="border-t border-edge" key={`${read.operatorId}:${read.kind}`}>
                <td className="py-1 pr-2 font-mono">{read.operatorId}</td>
                <td className="py-1 pr-2">{KINDS[read.kind]}</td>
                <td className="py-1 pr-2 text-right font-mono tabular-nums">{read.reads}</td>
                <td className="py-1 font-mono tabular-nums" title={`First read ${at(read.firstReadAt)}`}>
                  {at(read.lastReadAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
