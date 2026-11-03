"use client";

import type { GetSessionTranscriptResponse } from "@errand/contracts";
import { Check } from "lucide-react";

import { Presence, Reveal } from "@/components/layout-motion";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import type { OperatorRead } from "./use-operator-read";

// The session's conversation, read-only, as v3's operator console draws it: the person's words in a
// bubble on the right, the agent's reply as plain text, and the tools each reply called as quiet rows
// with their names in mono (they are code). Nothing here can send a message or tap a card; that is the
// person's chat. New messages arrive with a 4px rise as the console polls.

export function Transcript({ transcript }: { readonly transcript: OperatorRead<GetSessionTranscriptResponse> }) {
  return (
    <section aria-label="Transcript" className="grid content-start gap-3">
      <h2 className="m-0 text-lg leading-tight font-semibold text-fg">Transcript</h2>
      {transcript.status === "loading" && <Spinner aria-label="Loading the transcript" />}
      {transcript.status === "failed" && (
        <p className="m-0 rounded-md bg-danger-tint px-3 py-2 text-sm text-danger-text" role="alert">
          Can&apos;t read the transcript: {transcript.message}
        </p>
      )}
      {transcript.status === "ready" && transcript.data.messages.length === 0 && (
        <p className="m-0 text-sm text-fg-2">Nothing has been said in this session yet.</p>
      )}
      {transcript.status === "ready" && transcript.data.messages.length > 0 && (
        <ol aria-label="Messages" className="m-0 flex list-none flex-col gap-4 p-0">
          <Presence>
            {transcript.data.messages.map((message, index) => {
              const person = message.role === "user";
              return (
                <Reveal
                  as="li"
                  aria-label={`${person ? "Person" : "Agent"}, message ${index + 1}`}
                  className={cn("flex flex-col gap-2", person ? "items-end" : "items-start")}
                  // A transcript only grows; a message's place is its identity.
                  key={index}
                >
                  {message.text !== "" && (
                    <p
                      className={cn(
                        "m-0 max-w-[65ch] text-base whitespace-pre-wrap text-fg",
                        person && "max-w-[85%] rounded-panel rounded-ee-sm bg-surface-2 px-4 py-2.5",
                      )}
                    >
                      {message.text}
                    </p>
                  )}
                  {/* Plain lines, not a nested list: a message is one item of "Messages", its tools are part of it. */}
                  {message.tools.length > 0 && (
                    <div className="flex flex-col gap-1">
                      {message.tools.map((tool, call) => (
                        // eslint-disable-next-line react/no-array-index-key -- the same tool can be called twice in one reply
                        <p key={call} className="m-0 flex items-center gap-2 text-sm text-fg-2">
                          <Check aria-hidden className="size-4 text-success-text" />
                          <span className="sr-only">Tool called:</span>
                          <code className="font-mono text-xs text-fg">{tool}</code>
                        </p>
                      ))}
                    </div>
                  )}
                </Reveal>
              );
            })}
          </Presence>
        </ol>
      )}
    </section>
  );
}
