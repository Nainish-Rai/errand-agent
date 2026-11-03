"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { ANSWER, burstyStream } from "@/features/chat/streaming/bursty-stream";
import { StreamingAnswer } from "@/features/chat/streaming/streaming-answer";

// The streamed answer on the gallery: Replay feeds the real StreamingAnswer from the same seeded,
// bursty fake model the tests use, so the reveal and the per-word blur-in can be watched (and
// screenshot mid-stream) without a model. The reduced-motion panel forces the reduced look.

export function StreamingSpecimen({ label, reduced = false }: { readonly label: string; readonly reduced?: boolean }) {
  const [run, setRun] = useState(0);
  const [text, setText] = useState(ANSWER);
  const [isRunning, setRunning] = useState(false);

  useEffect(() => {
    if (run === 0) return;
    const chunks = burstyStream(ANSWER, 7);
    const timers = chunks.map((chunk) => setTimeout(() => setText(chunk.text), chunk.at));
    timers.push(setTimeout(() => setRunning(false), chunks.at(-1)!.at + 30));
    return () => timers.forEach(clearTimeout);
  }, [run]);

  return (
    <figure aria-label={label} className="m-0 flex flex-col gap-3" data-force-reduced-motion={reduced ? "" : undefined}>
      <Button
        className="self-start"
        size="sm"
        variant="secondary"
        onClick={() => {
          setText("");
          setRunning(true);
          setRun((count) => count + 1);
        }}
      >
        Replay {label.toLowerCase()}
      </Button>
      <StreamingAnswer key={run} text={text} isRunning={isRunning} />
    </figure>
  );
}
