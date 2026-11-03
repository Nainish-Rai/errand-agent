// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ANSWER, burstyStream } from "./bursty-stream";
import { StreamingAnswer } from "./streaming-answer";

// The answer component in a DOM, fed by the same fake bursty model (bursty-stream.ts) as the pacer test, frame by frame on
// a fake clock: what the reader's browser would get from Streamdown with the word plugin.
// The frames are faked (requestAnimationFrame on the fake clock); nothing here animates, so the reduced
// motion rules don't apply to this file. The reduced-motion look is CSS, proven in the browser.

const FRAME_MS = 16;

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout"] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function words(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("[data-stream-word]")];
}

function stream(): HTMLElement {
  return container.querySelector<HTMLElement>('[data-slot="stream"]')!;
}

describe("a streamed answer in the DOM", () => {
  it("mounts each word once, never re-renders a shown word, is aria-busy while streaming and unwraps at the end", () => {
    const chunks = burstyStream(ANSWER, 7);
    const removedWords: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (node instanceof HTMLElement && (node.matches("[data-stream-word]") || node.querySelector("[data-stream-word]") !== null)) {
            removedWords.push(node.textContent ?? "");
          }
        }
        if (record.type === "characterData" && record.target.parentElement?.matches("[data-stream-word]")) {
          removedWords.push(`changed: ${record.target.textContent}`);
        }
      }
    });

    act(() => root.render(<StreamingAnswer text="" isRunning />));
    observer.observe(container, { childList: true, subtree: true, characterData: true });

    const seen = new Map<HTMLElement, string>();
    let busyWhileStreaming = 0;
    let next = 0;
    const last = chunks.at(-1)!;
    for (let now = 0; now < last.at + 2000; now += FRAME_MS) {
      while (next < chunks.length && chunks[next]!.at <= now) {
        const { text } = chunks[next++]!;
        act(() => root.render(<StreamingAnswer text={text} isRunning />));
      }
      act(() => vi.advanceTimersByTime(FRAME_MS));
      if (stream().dataset.phase === "streaming") {
        if (stream().getAttribute("aria-busy") === "true") busyWhileStreaming += 1;
        for (const word of words()) {
          // A word shown earlier is the same node with the same text: it never re-mounts, so it never re-animates.
          if (seen.has(word)) expect(word.textContent).toBe(seen.get(word));
          else seen.set(word, word.textContent ?? "");
        }
        for (const word of seen.keys()) expect(word.isConnected).toBe(true);
      }
    }
    expect(seen.size).toBeGreaterThan(40);
    expect(busyWhileStreaming).toBeGreaterThan(10);
    expect(removedWords).toEqual([]);

    // The model ends; the rest flushes word by word, the last word settles, and the spans unwrap.
    act(() => root.render(<StreamingAnswer text={ANSWER} isRunning={false} />));
    for (let frame = 0; frame < 120 && stream().dataset.phase !== "done"; frame++) act(() => vi.advanceTimersByTime(FRAME_MS));
    observer.disconnect();

    expect(stream().dataset.phase).toBe("done");
    expect(words()).toEqual([]);
    expect(stream().hasAttribute("aria-busy")).toBe(false);
    // The whole answer, paragraph by paragraph, as plain text.
    const paragraphs = [...stream().querySelectorAll("p")].map((paragraph) => paragraph.textContent);
    expect(paragraphs).toEqual(ANSWER.replaceAll("**", "").split("\n\n"));
  });

  it("draws no media from an answer that smuggles some, while streaming with the word plugin and once done", () => {
    // Photos come only from the image registry (ticket 22); answer text, which may repeat a tool or a
    // review, must never make the browser fetch: not a markdown image, raw <img>, <picture>/<source>,
    // media posters, or a CSS url().
    const SMUGGLED = [
      "Here are the plumbers. ![leak](https://images.example.com/md.png)",
      '<img src="/hostile/raw.webp" alt="raw"> and <picture><source srcset="/hostile/source.webp"></picture>',
      '<video poster="/hostile/poster.webp"></video><iframe src="/hostile/frame"></iframe>',
      '<span style="background-image:url(/hostile/css.webp)">styled</span> Which one should I book?',
    ].join("\n\n");
    const media = () => container.querySelectorAll('img, picture, source, image, video, audio, iframe, object, embed, [src], [srcset], [poster], [style*="url("]');

    act(() => root.render(<StreamingAnswer text="" isRunning />));
    let streamingFrames = 0;
    for (let end = 8; end <= SMUGGLED.length + 8; end += 8) {
      act(() => root.render(<StreamingAnswer text={SMUGGLED.slice(0, end)} isRunning />));
      act(() => vi.advanceTimersByTime(FRAME_MS * 4));
      if (stream().dataset.phase === "streaming" && words().length > 0) streamingFrames += 1;
      expect(media()).toHaveLength(0);
    }
    expect(streamingFrames).toBeGreaterThan(5);

    act(() => root.render(<StreamingAnswer text={SMUGGLED} isRunning={false} />));
    for (let frame = 0; frame < 400 && stream().dataset.phase !== "done"; frame++) act(() => vi.advanceTimersByTime(FRAME_MS));
    expect(stream().dataset.phase).toBe("done");
    expect(media()).toHaveLength(0);
    expect(stream().textContent).toContain("styled");
    expect(stream().textContent).toContain("Which one should I book?");
  });

  it("shows an answer that was already complete at once, with nothing to unwrap", () => {
    act(() => root.render(<StreamingAnswer text={ANSWER} isRunning={false} />));
    expect(stream().dataset.phase).toBe("done");
    expect(words()).toEqual([]);
    expect(stream().hasAttribute("aria-busy")).toBe(false);
  });
});
