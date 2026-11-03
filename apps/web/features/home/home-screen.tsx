"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";

import { Presence, Reveal, useLimeTiming } from "@/components/layout-motion";
import { MemorySheet } from "@/features/memory-panel/memory-sheet";

import { Composer, useErrandComposer } from "./composer";
import { AlertsList, InProgressList, UpcomingList } from "./home-lists";
import { useServicePhotos } from "./service-photos";
import { FollowUps, ServiceTiles } from "./service-tiles";
import { TopBar } from "./top-bar";
import { HOME_POLL_MS, useHomeSummary } from "./use-home-summary";

// Home, as v3's "Home and the composer" draws it: a greeting, the composer, three requests the person
// could have typed, the service tiles, then the lists (In progress while something runs, Upcoming and
// Alerts). No stat cards and no icon tiles. Everything comes from one GET /api/v1/home, polled. Sending
// turns home into the conversation: the suggestions and lists step aside while the chat starts.

const SUGGESTIONS = ["Plumber for a leaking kitchen tap this week", "AC servicing on Saturday morning", "Same electrician as last time"];

const clockFormat = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const istHour = new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" });

/** From the backend's clock, in IST, so the greeting matches the person's day and the server's render. */
function greetingAt(isoTime: string): string {
  const hour = Number(istHour.format(new Date(isoTime)));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * Re-renders every second, so "0:42" labels keep moving between refreshes. The clock is read only after
 * mount: the page is prerendered, and every label that uses it waits for the fetched summary anyway.
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

/** The greeting fades in once the summary says what time it is, in a line that is already there. */
function Greeting({ generatedAt }: { readonly generatedAt?: string }) {
  const timing = useLimeTiming();
  const greeting = generatedAt === undefined ? undefined : greetingAt(generatedAt);
  return (
    <div className="grid gap-1">
      <h1 className="m-0 min-h-[1lh] text-2xl leading-tight font-semibold tracking-tight text-fg">
        <Presence>
          {greeting !== undefined && (
            <motion.span key={greeting} className="block" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: timing.arrive }}>
              {greeting}
            </motion.span>
          )}
        </Presence>
      </h1>
      <p className="m-0 text-base text-fg-2">What errand should I handle?</p>
    </div>
  );
}

export function HomeScreen() {
  const { summary, error } = useHomeSummary();
  const composer = useErrandComposer(summary);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const nowMs = useNow(1_000);
  const photos = useServicePhotos();

  const focusComposer = () => composer.input.current?.focus();
  const settled = !composer.sending;

  return (
    <main className="min-h-dvh bg-page">
      <TopBar summary={summary} onNewErrand={focusComposer} onOpenMemory={() => setMemoryOpen(true)} />
      <div className="mx-auto flex w-full max-w-[42rem] flex-col gap-8 px-4 pt-6 pb-10">
        <div className="grid gap-4">
          <Greeting generatedAt={summary?.generatedAt} />
          <Composer composer={composer} />
          <Presence>
            {settled && (
              <Reveal key="suggestions">
                <FollowUps suggestions={SUGGESTIONS} disabled={composer.sending} onPick={composer.send} mediaFor={photos.suggestion} />
              </Reveal>
            )}
          </Presence>
        </div>

        {/* Once the person sends, home's lists collapse while the chat starts (v3 Home: "home's lists collapse"). */}
        <Presence>
          {settled && (
            <Reveal key="lists" rise={0} className="flex flex-col gap-8">
              <ServiceTiles disabled={composer.sending} onPick={composer.send} mediaFor={photos.tile} />
              <Presence>
                {summary !== undefined && summary.working.length > 0 && (
                  <Reveal key="in-progress">
                    <InProgressList summary={summary} />
                  </Reveal>
                )}
              </Presence>
              <UpcomingList summary={summary} onStart={focusComposer} />
              <AlertsList summary={summary} nowMs={nowMs} onOpenMemory={() => setMemoryOpen(true)} />
            </Reveal>
          )}
        </Presence>

        <footer className="flex justify-end">
          <p role="status" className="m-0 inline-flex items-center gap-2 text-xs text-fg-3">
            {error === undefined ? (
              <>
                <span aria-hidden className="size-2 rounded-full bg-success" />
                Live · refreshes every {HOME_POLL_MS / 1_000} s
                {summary !== undefined && <span className="tabular-nums">· {clockFormat.format(new Date(summary.generatedAt))}</span>}
              </>
            ) : (
              <>
                <span aria-hidden className="size-2 rounded-full bg-danger" />
                Can&apos;t reach the backend · retrying
              </>
            )}
          </p>
        </footer>
      </div>
      <MemorySheet open={memoryOpen} onOpenChange={setMemoryOpen} fallbackFocus={focusComposer} />
    </main>
  );
}
