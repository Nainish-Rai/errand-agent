"use client";

import type { GetSessionTranscriptResponse } from "@errand/contracts";

import { Spinner } from "@/components/ui/spinner";

import type { OperatorRead } from "./use-operator-read";

// The session's conversation, read-only: what the person and the agent said, and which tools each
// reply called. Nothing here can send a message or tap a card; that is the person's chat.

export function Transcript({ transcript }: { readonly transcript: OperatorRead<GetSessionTranscriptResponse> }) {
  return (
    <section aria-label="Transcript" className="grid content-start gap-2">
      <h2 className="m-0 text-label font-normal text-fg-meta">Transcript (read-only)</h2>
      {transcript.status === "loading" && <Spinner aria-label="Loading the transcript" />}
      {transcript.status === "failed" && (
        <p className="m-0 rounded-md bg-err-tint px-3 py-2 text-body" role="alert">
          Can&apos;t read the transcript: {transcript.message}
        </p>
      )}
      {transcript.status === "ready" && transcript.data.messages.length === 0 && (
        <p className="m-0 text-body text-fg-meta">Nothing has been said in this session yet.</p>
      )}
      {transcript.status === "ready" && transcript.data.messages.length > 0 && (
        <ol aria-label="Messages" className="m-0 grid list-none gap-2 p-0">
          {transcript.data.messages.map((message, index) => {
            const speaker = message.role === "user" ? "Person" : "Agent";
            return (
              <li
                aria-label={`${speaker}, message ${index + 1}`}
                className={message.role === "user" ? "rounded-md border border-edge bg-surface-raised px-3 py-2" : "rounded-md border border-edge bg-surface-card px-3 py-2"}
                // eslint-disable-next-line react/no-array-index-key -- a transcript only grows; a message's place is its identity
                key={index}
              >
                <p className="m-0 mb-1 text-label text-fg-meta">{speaker}</p>
                {message.text !== "" && <p className="m-0 text-body whitespace-pre-wrap text-fg-body">{message.text}</p>}
                {message.tools.length > 0 && (
                  <p className="m-0 mt-1 font-mono text-label text-fg-meta">tools: {message.tools.join(", ")}</p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
