// How many tokens a piece of the model's context costs. There is no MiniMax tokenizer for
// JavaScript, so this is a conservative character-based estimate, stated as one: one token per
// two UTF-8 bytes, rounded up. MiniMax-M3 reported about 2.5 bytes per token on our tool-result
// JSON and about 3.5 on prose (live traces, 2026-11-03); on the live context-budget recording every
// call's estimate was 1.6 to 1.9 times the input tokens MiniMax reported. So the estimate is high,
// never low, and a context that fits the estimate fits the model.

export const BYTES_PER_TOKEN = 2;

/** What each message adds besides its text: role markers and part framing. */
export const MESSAGE_OVERHEAD_TOKENS = 4;

function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

export function estimateTokens(text: string): number {
  return Math.ceil(utf8Bytes(text) / BYTES_PER_TOKEN);
}

/** A whole message: its text plus the framing every message carries. */
export function estimateMessageTokens(text: string): number {
  return estimateTokens(text) + MESSAGE_OVERHEAD_TOKENS;
}
