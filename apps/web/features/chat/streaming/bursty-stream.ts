// A fake model for the streaming tests: an answer cut into chunks of uneven size (1 to 140 characters,
// cut anywhere, even mid-word) with uneven gaps (10 ms to 800 ms, a quarter of them long pauses), from a
// seeded generator so every run is the same.

export const ANSWER =
  "Shiva Sanitary Solutions can come on Thursday at 8:00 am for ₹399, which fits your ₹1,500 plumbing budget. " +
  "They are rated 4.8 from 212 reviews and are 1.2 km away in 6th Block.\n\n" +
  "AquaFix Plumbing is cheaper on Friday afternoon, but **their earliest slot** is a day later. " +
  "Ravi Plumbing can come tonight at 6:30 pm, at ₹999.\n\n" +
  "Tap Approve ₹399 on the card if Shiva Sanitary works for you, or ask me for other times.";

/** mulberry32, the generator v3's own demo uses. */
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Chunk = { readonly at: number; readonly text: string };

/** The answer as bursts: each chunk's arrival time and the text so far. */
export function burstyStream(text: string, seed: number): Chunk[] {
  const random = generator(seed);
  const chunks: Chunk[] = [];
  let at = 120;
  let cut = 0;
  while (cut < text.length) {
    const size = 1 + Math.floor(random() * 140);
    cut = Math.min(text.length, cut + size);
    chunks.push({ at, text: text.slice(0, cut) });
    at += random() < 0.25 ? 350 + random() * 450 : 10 + random() * 140;
  }
  return chunks;
}
