"use client";

import { useEffect, useRef, useState } from "react";

import { SuggestionChip } from "@/components/chip";

import { Composer } from "./composer";
import { HeroSkyline } from "./hero-skyline";
import { TopBar } from "./top-bar";
import { HOME_POLL_MS, useHomeSummary } from "./use-home-summary";
import { Alerts, BookingActivity, MemoryWidget, UpcomingBookings, WaitingOnYou, WorkingNow } from "./widgets";

// The home screen (mockups/home.html): the hero skyline with the headline and the top bar, the
// errand composer over its lower edge, suggestions, then the widget grid, two columns and one on
// a phone. Everything comes from one GET /api/v1/home, polled.

const SUGGESTIONS = ["Plumber for a leaking kitchen tap this week", "AC servicing on Saturday morning", "Same electrician as last time"];

const clockFormat = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** Re-renders every few seconds, so "0:42 ago" labels keep moving between refreshes. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
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
    <main className="min-h-dvh bg-surface-well sm:px-4 sm:py-4">
      <div ref={shell} className="mx-auto max-w-[56rem] overflow-hidden bg-surface-canvas pb-4 sm:rounded-lg sm:border sm:border-edge">
        <header className="relative h-[230px]">
          <TopBar summary={summary} onNewErrand={focusComposer} />
          <HeroSkyline />
          <h1 className="absolute bottom-5 w-full px-4 text-center text-title font-semibold tracking-tight text-fg-emph [text-shadow:var(--hero-title-shadow)]">
            What errand should I handle?
          </h1>
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
            className="m-0 inline-flex items-center gap-1.5 rounded-md border border-edge bg-surface-card px-2 py-1 text-label text-fg-meta"
          >
            {error === undefined ? (
              <>
                <span aria-hidden className="text-ok">●</span>
                Live · refreshes every {HOME_POLL_MS / 1_000} s
                {summary !== undefined && <span className="font-mono tabular-nums">· {clockFormat.format(new Date(summary.generatedAt))}</span>}
              </>
            ) : (
              <>
                <span aria-hidden className="text-err">●</span>
                Can&apos;t reach the backend · retrying
              </>
            )}
          </p>
        </footer>
      </div>
    </main>
  );
}
