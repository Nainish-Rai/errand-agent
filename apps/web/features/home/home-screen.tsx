"use client";

import { useEffect, useRef, useState } from "react";

import { SuggestionChip } from "@/components/chip";

import { Composer } from "./composer";
import { TopBar } from "./top-bar";
import { HOME_POLL_MS, useHomeSummary } from "./use-home-summary";
import { Alerts, BookingActivity, MemoryWidget, UpcomingBookings, WaitingOnYou, WorkingNow } from "./widgets";

// The home screen (mockups/home.html): the hero skyline with the headline and the top bar, the
// errand composer over its lower edge, suggestions, then the widget grid, two columns and one on
// a phone. Everything comes from one GET /api/v1/home, polled.

const SUGGESTIONS = ["Plumber for a leaking kitchen tap this week", "AC servicing on Saturday morning", "Same electrician as last time"];

const clockFormat = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/**
 * Re-renders every few seconds, so "0:42 ago" labels keep moving between refreshes. The clock is
 * read only after mount: the page is prerendered, and every label that uses it waits for the
 * fetched summary anyway.
 */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function HomeScreen() {
  const { summary, error } = useHomeSummary();
  const [prompt, setPrompt] = useState("");
  const nowMs = useNow(1_000);
  const shell = useRef<HTMLDivElement>(null);

  const focusComposer = () => shell.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  const suggest = (text: string) => {
    setPrompt(text);
    focusComposer();
  };

  return (
    <main className="min-h-dvh bg-surface-2 sm:px-4 sm:py-4">
      <div ref={shell} className="mx-auto max-w-[56rem] overflow-hidden bg-page pb-4 sm:rounded-panel sm:border sm:border-line">
        {/* v3 has no hero illustration (Lime allows no decoration): the bar, then the page title. */}
        <header className="relative pt-16 pb-5">
          <TopBar summary={summary} onNewErrand={focusComposer} />
          <h1 className="w-full px-4 text-center text-xl font-semibold tracking-tight text-fg sm:text-2xl">What errand should I handle?</h1>
        </header>

        <Composer summary={summary} prompt={prompt} onPromptChange={setPrompt} />

        <div role="group" aria-label="Suggestions" className="mx-3 mt-2.5 mb-3 flex flex-wrap justify-center gap-1.5">
          {SUGGESTIONS.map((text) => (
            <SuggestionChip key={text} onClick={() => suggest(text)}>
              {text}
            </SuggestionChip>
          ))}
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-2 px-3 min-[560px]:grid-cols-[repeat(2,minmax(0,1fr))]">
          <WorkingNow summary={summary} nowMs={nowMs} />
          <WaitingOnYou summary={summary} />
          <UpcomingBookings summary={summary} />
          <Alerts summary={summary} nowMs={nowMs} />
          <BookingActivity summary={summary} onStart={focusComposer} />
          <MemoryWidget summary={summary} />
        </div>

        <footer className="mt-3 flex justify-end px-3">
          <p
            role="status"
            className="m-0 inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-xs text-fg-3"
          >
            {error === undefined ? (
              <>
                <span aria-hidden className="text-success-text">●</span>
                Live · refreshes every {HOME_POLL_MS / 1_000} s
                {summary !== undefined && <span className="tabular-nums">· {clockFormat.format(new Date(summary.generatedAt))}</span>}
              </>
            ) : (
              <>
                <span aria-hidden className="text-danger-text">●</span>
                Can&apos;t reach the backend · retrying
              </>
            )}
          </p>
        </footer>
      </div>
    </main>
  );
}
