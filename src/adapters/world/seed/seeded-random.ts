// Every random draw in the mock world is a pure function of the seed and a label, so the same
// seed and the same calls give the same world, run after run, in any order.

/** FNV-1a over the joined parts. */
function hashParts(parts: readonly (string | number)[]): number {
  let hash = 0x811c9dc5;
  for (const char of parts.join("␟")) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A stream of floats in [0, 1) (mulberry32), seeded from the parts. */
export class SeededRandom {
  #state: number;

  constructor(...parts: readonly (string | number)[]) {
    this.#state = hashParts(parts);
  }

  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) | 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** An integer in [min, max]. */
  integer(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error("Cannot pick from an empty list.");
    return item;
  }

  /** `count` distinct items, in their original order. */
  sample<T>(items: readonly T[], count: number): T[] {
    const ranked = items.map((item, index) => ({ item, index, key: this.next() }));
    return ranked
      .sort((a, b) => a.key - b.key)
      .slice(0, count)
      .sort((a, b) => a.index - b.index)
      .map(({ item }) => item);
  }
}

/** One draw in [0, 1) for a labelled event, independent of every other draw. */
export function drawFor(...parts: readonly (string | number)[]): number {
  return new SeededRandom(...parts).next();
}
