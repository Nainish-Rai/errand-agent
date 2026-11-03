"use client";

import { ApiClient } from "@errand/client";
import type { GetSessionTraceResponse } from "@errand/contracts";
import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { TraceWaterfall } from "@/components/agents/trace-waterfall";
import { Button } from "@/components/ui/button";

import { ErrandStates } from "./errand-states";
import { toWaterfallTrace, type WaterfallTrace } from "./waterfall-spans";

// The session's run trace beside the chat, as a live waterfall. It polls the backend's trace route
// while it is open, so model and tool calls appear as they start and fill in as they settle.

const POLL_MS = 1_000;
const TICK_MS = 100;

interface FetchedTrace {
  readonly trace: GetSessionTraceResponse;
  /** Server clock minus browser clock, so running spans grow on the server's timeline. */
  readonly clockOffsetMs: number;
}

/**
 * Polls the session's trace while the panel is open, and fetches at once whenever the chat
 * reports new activity, so a turn shows up as soon as it starts rather than on the next tick.
 */
function useSessionTrace(api: ApiClient, sessionId: string, activity: number): { fetched?: FetchedTrace; error?: string } {
  const [fetched, setFetched] = useState<FetchedTrace>();
  const [error, setError] = useState<string>();
  const pollNow = useRef<() => void>(() => undefined);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let again = false;
    const poll = async () => {
      clearTimeout(timer);
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      try {
        const trace = await api.getSessionTrace(sessionId, { signal: controller.signal });
        setFetched({ trace, clockOffsetMs: trace.generatedAtMs - Date.now() });
        setError(undefined);
      } catch (failure) {
        if (controller.signal.aborted) return;
        setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        inFlight = false;
      }
      if (controller.signal.aborted) return;
      if (again) {
        again = false;
        void poll();
      } else {
        timer = setTimeout(poll, POLL_MS);
      }
    };
    pollNow.current = () => void poll();
    setFetched(undefined);
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
      pollNow.current = () => undefined;
    };
  }, [api, sessionId]);

  useEffect(() => {
    pollNow.current();
  }, [activity]);

  return { fetched, error };
}

type ClockMode =
  | { readonly kind: "live" }
  | { readonly kind: "replay"; readonly startedAtMs: number; readonly fromSeconds: number }
  | { readonly kind: "paused"; readonly atSeconds: number };

function nowOf(mode: ClockMode, waterfall: WaterfallTrace, clockOffsetMs: number, speed: number): number {
  const liveNow = waterfall.running
    ? Math.max((Date.now() + clockOffsetMs - waterfall.originMs) / 1000, waterfall.endSeconds)
    : waterfall.endSeconds;
  if (mode.kind === "paused") return Math.min(mode.atSeconds, liveNow);
  if (mode.kind === "replay") return Math.min(liveNow, mode.fromSeconds + ((Date.now() - mode.startedAtMs) / 1000) * speed);
  return liveNow;
}

/** Trace time for the waterfall: live while spans run, then a replay the person can pause and restart. */
function useTraceClock(waterfall: WaterfallTrace | undefined, clockOffsetMs: number) {
  const [mode, setMode] = useState<ClockMode>({ kind: "live" });
  const [speed, setSpeed] = useState(1);
  const [, setTick] = useState(0);
  const running = waterfall?.running ?? false;
  const now = waterfall === undefined ? 0 : nowOf(mode, waterfall, clockOffsetMs, speed);
  const replayDone = mode.kind === "replay" && !running && waterfall !== undefined && now >= waterfall.endSeconds;
  const moving = mode.kind === "replay" || (mode.kind === "live" && running);

  useEffect(() => {
    if (!moving) return;
    const interval = setInterval(() => setTick((value) => value + 1), TICK_MS);
    return () => clearInterval(interval);
  }, [moving]);

  useEffect(() => {
    if (replayDone) setMode({ kind: "live" });
  }, [replayDone]);

  return {
    now,
    playing: moving,
    speed,
    setPlaying: (play: boolean) =>
      setMode(play ? { kind: "replay", startedAtMs: Date.now(), fromSeconds: now } : { kind: "paused", atSeconds: now }),
    setSpeed: (next: number) => {
      if (mode.kind === "replay") setMode({ kind: "replay", startedAtMs: Date.now(), fromSeconds: now });
      setSpeed(next);
    },
    onReplay: () => setMode({ kind: "replay", startedAtMs: Date.now(), fromSeconds: 0 }),
  };
}

function summaryOf(trace: GetSessionTraceResponse | undefined): string {
  if (trace === undefined) return "Loading the trace…";
  const { totals } = trace;
  const tokens = (totals.inputTokens + totals.outputTokens).toLocaleString("en-IN");
  return `${totals.modelCalls} model calls · ${totals.toolCalls} tool calls · ${tokens} tokens · $${totals.costUsd.toFixed(4)} estimated`;
}

export function TracePanel({
  sessionId,
  activity,
  backendUrl,
  onClose,
}: {
  /** The session the chat is streaming; the panel follows it from the first message. */
  readonly sessionId: string;
  /** Changes whenever the chat sees new session events. */
  readonly activity: number;
  readonly backendUrl: string;
  readonly onClose: () => void;
}) {
  const api = useMemo(() => new ApiClient({ baseUrl: backendUrl }), [backendUrl]);
  const { fetched, error } = useSessionTrace(api, sessionId, activity);
  const waterfall = useMemo(() => (fetched === undefined ? undefined : toWaterfallTrace(fetched.trace)), [fetched]);
  const clock = useTraceClock(waterfall, fetched?.clockOffsetMs ?? 0);

  return (
    <aside
      aria-label="Run trace"
      className="fixed inset-0 z-20 flex h-dvh w-full flex-col gap-3 overflow-y-auto border-l border-border bg-background p-3 lg:static lg:z-auto lg:w-[40rem] lg:shrink-0"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{summaryOf(fetched?.trace)}</p>
        <Button aria-label="Close the trace" size="icon" variant="ghost" onClick={onClose}>
          <X />
        </Button>
      </div>
      {error !== undefined && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm" role="alert">
          Can&apos;t read the trace: {error}
        </p>
      )}
      {fetched !== undefined && <ErrandStates trace={fetched.trace} />}
      {waterfall !== undefined && waterfall.spans.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Send a message and the run shows up here.</p>
      ) : (
        <TraceWaterfall
          title="Run trace"
          spans={waterfall?.spans ?? []}
          now={clock.now}
          playing={clock.playing}
          onPlayingChange={clock.setPlaying}
          onReplay={clock.onReplay}
          speed={clock.speed}
          onSpeedChange={clock.setSpeed}
        />
      )}
    </aside>
  );
}
