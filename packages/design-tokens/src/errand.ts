// Errand's only additions to Lime, copied from design-system/design-system-v3.html (after the lime source).
import type { LimeToken } from "./lime";

/** Lime has no equivalent for these ideas, so they alias Lime roles and add no value. */
export const errandColorExtensions: readonly LimeToken[] = [
  ["errand-ok-fill", "var(--success)", "the solid mark of a provider-confirmed booking | tracker booked mark"],
  ["errand-on-ok-fill", "var(--page)", "the check drawn on that mark, page white on light and near-black on dark | tracker booked mark"],
  ["errand-inferred-edge", "var(--warn)", "the dashed edge of a fact Errand inferred or took from memory | memory, request chips"],
];

/** Streaming answers: the owner's deliberate bend of Lime's no-stream-effects rule. */
export const errandMotionExtensions: readonly LimeToken[] = [
  ["dur-stream-word", "240ms", "one streamed word's blur-in | streaming answer text"],
  ["dur-stream-lag", "400ms", "the most the reveal may trail the stream before it speeds up | streaming answer text"],
];

/** Reduced motion: a streamed word appears at once, with no blur or rise. The pacing (--dur-stream-lag) stays. */
export const errandReducedMotion: readonly LimeToken[] = [["dur-stream-word", "0ms", ""]];

/**
 * Errand fix for two Lime dark values. With the near-black dark --on-danger, Lime's dark --danger-hover is 4.06:1
 * and its pressed danger glow top is 4.26:1, under AA, though tokens.css notes 4.6. Each is pointed at a Lime
 * value that passes (--danger 4.90:1, the resting glow top 4.56:1). The light theme is untouched.
 */
export const errandDarkFixes: readonly LimeToken[] = [
  ["danger-hover", "var(--danger)", ""],
  ["glow-danger-from-press", "var(--glow-danger-from)", ""],
];
