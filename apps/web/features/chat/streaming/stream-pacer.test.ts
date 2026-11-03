import { describe, expect, it } from "vitest";

import { ANSWER, burstyStream, type Chunk } from "./bursty-stream";
import { StreamPacer } from "./stream-pacer";

// The pacer against a fake bursty model (bursty-stream.ts), on a 60 Hz display.

const LAG_MS = 400;
const FRAME_MS = 1000 / 60;

type Run = {
  /** Per frame: the time and the visible text. */
  readonly frames: { readonly at: number; readonly visible: string }[];
  readonly endedAt: number;
  readonly settledAt: number;
};

function play(chunks: readonly Chunk[]): Run {
  const pacer = new StreamPacer(LAG_MS);
  const frames: { at: number; visible: string }[] = [];
  const last = chunks.at(-1)!;
  let next = 0;
  let endedAt = Number.POSITIVE_INFINITY;
  for (let now = 0; now < last.at + 10_000; now += FRAME_MS) {
    while (next < chunks.length && chunks[next]!.at <= now) pacer.receive(chunks[next++]!.text, chunks[next - 1]!.at);
    // The model ends a little after its last chunk, as eve's turn does.
    if (next === chunks.length && endedAt === Number.POSITIVE_INFINITY && now >= last.at + 30) {
      pacer.end();
      endedAt = now;
    }
    frames.push({ at: now, visible: pacer.tick(now) });
    if (pacer.isSettled) return { frames, endedAt, settledAt: now };
  }
  throw new Error("the reveal never settled");
}

/** Where each word of the answer ends, in characters. */
function wordEnds(text: string): number[] {
  return [...text.matchAll(/\S+/g)].map((match) => match.index + match[0].length);
}

/** When a word was whole: when text after it arrived, or the stream ended. */
function wholeAt(end: number, chunks: readonly Chunk[], endedAt: number): number {
  return chunks.find((chunk) => chunk.text.length > end)?.at ?? endedAt;
}

describe("the paced reveal of a bursty stream", () => {
  for (const seed of [3, 7, 11, 42]) {
    const chunks = burstyStream(ANSWER, seed);
    const run = play(chunks);

    it(`never trails a whole word by more than --dur-stream-lag (seed ${seed})`, () => {
      const trails = wordEnds(ANSWER).map((end) => {
        const shownAt = run.frames.find((frame) => frame.visible.length >= end)!.at;
        return shownAt - wholeAt(end, chunks, run.endedAt);
      });
      expect(trails.length).toBeGreaterThan(40);
      // One frame of slack: a word that becomes due between frames shows on the next one.
      expect(Math.max(...trails)).toBeLessThanOrEqual(LAG_MS + FRAME_MS);
    });

    it(`only ever adds whole words after what is shown (seed ${seed})`, () => {
      let previous = "";
      for (const { visible } of run.frames) {
        expect(visible.startsWith(previous), JSON.stringify([previous.slice(-15), visible.slice(-15)])).toBe(true);
        expect(ANSWER.startsWith(visible)).toBe(true);
        // What shows ends at a word's end: the next character, if any, is whitespace.
        expect(visible === "" || visible.length === ANSWER.length || /\s/.test(ANSWER[visible.length]!), JSON.stringify(visible.slice(-15))).toBe(true);
        previous = visible;
      }
      expect(previous).toBe(ANSWER.trimEnd());
    });

    it(`reveals evenly, word by word, and does not jump when the stream ends (seed ${seed})`, () => {
      const words = run.frames.map((frame) => (frame.visible.match(/\S+/g) ?? []).length);
      const perFrame = words.slice(1).map((count, i) => count - words[i]!);
      // A burst of 140 characters never lands at once: at most a few words a frame.
      expect(Math.max(...perFrame)).toBeLessThanOrEqual(4);
      // The end flushes the backlog quickly but over several frames, within the lag.
      const atEnd = words[run.frames.findIndex((frame) => frame.at >= run.endedAt)]!;
      const total = words.at(-1)!;
      if (total - atEnd > 3) {
        const flushFrames = perFrame.slice(run.frames.findIndex((frame) => frame.at >= run.endedAt)).filter((n) => n > 0).length;
        expect(flushFrames).toBeGreaterThan(1);
      }
      expect(run.settledAt - run.endedAt).toBeLessThanOrEqual(LAG_MS + FRAME_MS);
    });
  }

  it("starts over when the text is replaced", () => {
    const pacer = new StreamPacer(LAG_MS);
    pacer.receive("Hello there ", 0);
    for (let now = 0; now < 1000; now += FRAME_MS) pacer.tick(now);
    expect(pacer.visible).toBe("Hello there");
    pacer.receive("Goodbye ", 1000);
    expect(pacer.tick(1000 + FRAME_MS)).toBe("");
  });
});
