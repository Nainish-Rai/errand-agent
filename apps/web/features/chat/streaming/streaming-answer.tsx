"use client";

import { defaultRehypePlugins } from "streamdown";

import { Markdown } from "@/components/chat/markdown";

import { rehypeStreamWords } from "./rehype-stream-words";
import { usePacedText } from "./use-paced-text";

// An assistant answer as v3's Streaming answers section specifies: a frame-paced reveal (usePacedText)
// and a per-word blur-in over --dur-stream-word (rehypeStreamWords and the [data-stream-word] keyframes
// in globals.css). No caret, no shimmer. When the answer ends and its last word has settled, the spans
// unwrap to plain text and aria-busy goes, so a screen reader reads the answer once, whole.

const streamingRehypePlugins = [...Object.values(defaultRehypePlugins), rehypeStreamWords];

export function StreamingAnswer({ text, isRunning }: { readonly text: string; readonly isRunning: boolean }) {
  const paced = usePacedText(text, isRunning);
  const isAnimating = paced.phase !== "done";
  return (
    <div data-slot="stream" data-phase={paced.phase} aria-busy={isAnimating || undefined}>
      <Markdown isAnimating={isAnimating} rehypePlugins={isAnimating ? streamingRehypePlugins : undefined}>
        {paced.text}
      </Markdown>
    </div>
  );
}
