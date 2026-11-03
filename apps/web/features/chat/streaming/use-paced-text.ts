"use client";

import { useEffect, useRef, useState } from "react";

import { StreamPacer } from "./stream-pacer";

// Drives a StreamPacer from the chat runtime's text and the browser's frames. Text that was already
// complete when it first rendered (a replayed conversation) shows at once, with nothing to animate.
//
// Under reduced motion the pacing stays, as v3 specifies: it is reading speed, not decoration. What is
// reduced is each word's arrival: --dur-stream-word is 0 and the keyframes are opacity only (globals.css),
// so the frames here only decide when a word appears, never how it moves.

/** The phases of one answer: words still arriving, the last words still blurring in, then plain text. */
export type StreamPhase = "streaming" | "settling" | "done";

export type PacedText = { readonly text: string; readonly phase: StreamPhase };

/** v3's defaults, for a page whose tokens haven't loaded. */
const FALLBACK_LAG_MS = 400;
const FALLBACK_WORD_MS = 240;
/** The spans unwrap a little after the last word's animation, so it is never cut. */
const UNWRAP_AFTER_MS = 20;

function durationToken(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const value = Number.parseFloat(raw);
  if (Number.isNaN(value)) return fallback;
  return raw.endsWith("ms") ? value : raw.endsWith("s") ? value * 1000 : value;
}

export function usePacedText(source: string, isRunning: boolean): PacedText {
  const pacer = useRef<StreamPacer | undefined>(undefined);
  const [text, setText] = useState(isRunning ? "" : source);
  const [phase, setPhase] = useState<StreamPhase>(isRunning ? "streaming" : "done");

  useEffect(() => {
    if (phase === "done") return;
    pacer.current ??= new StreamPacer(durationToken("--dur-stream-lag", FALLBACK_LAG_MS));
    pacer.current.receive(source, performance.now());
    if (!isRunning) pacer.current.end();
  }, [source, isRunning, phase]);

  useEffect(() => {
    if (phase !== "streaming") return;
    let frame = 0;
    const step = (now: number) => {
      const current = pacer.current;
      if (current === undefined) return;
      const visible = current.tick(now);
      setText((shown) => (shown === visible ? shown : visible));
      if (current.isSettled) {
        setPhase("settling");
        return;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  useEffect(() => {
    if (phase !== "settling") return;
    const timer = setTimeout(() => setPhase("done"), durationToken("--dur-stream-word", FALLBACK_WORD_MS) + UNWRAP_AFTER_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  // Once done, the source is the answer: a late correction to it still shows.
  return phase === "done" ? { text: source, phase } : { text, phase };
}
