// The reveal pacing of a streamed answer, ported from design system v3's createStream (itself modelled
// on assistant-ui's useSmooth). Models send text in bursts of uneven size with uneven gaps; the pacer
// buffers what arrives and releases it at a time-based rate on every frame. The rate rises with the
// backlog, so the reveal trails the model by at most the lag and never stalls on a burst, and it eases
// toward its target so speed changes are smooth. A word is released only once it is whole, so the
// text on screen only ever grows by whole words and nothing already shown changes.
//
// Pure: no DOM and no clock of its own. The caller passes `now` (ms) to every call, which is what lets
// a test drive it with a fake stream and a fake clock.

/** The slowest the reveal goes while there is backlog, in characters a second (v3). */
const MIN_RATE = 30;
/** The shortest the lag gets when chunks arrive quickly, in seconds (v3: "between 300 and 400ms"). */
const MIN_LAG_S = 0.3;
/** A frame longer than this (a background tab) counts as this long, so the reveal never leaps. */
const MAX_FRAME_S = 0.064;
/** How quickly the rate follows its target: about a tenth of a second to close most of the gap. */
const RATE_FOLLOW = 10;
/** At the end the remainder flushes in about this share of the lag (v3). */
const FLUSH_SHARE = 0.6;

const NEXT_WORD = /^(\s*)(\S+)/;

type Arrival = { readonly end: number; readonly at: number };

export class StreamPacer {
  private received = "";
  /** Characters revealed, fractional: the rate moves it a little every frame. */
  private shown = 0;
  /** Characters released as whole words: received.slice(0, released) is what the reader sees. */
  private released = 0;
  private rate = 0;
  private lastFrame: number | undefined;
  private lastChunk: number | undefined;
  /** The smoothed gap between chunks, in seconds. */
  private gap = 0;
  private ended = false;
  private flushRate = 0;
  /** When each chunk arrived, so no character waits longer than the lag whatever the rate did. */
  private arrivals: Arrival[] = [];
  private deadline = 0;

  /** `lagMs` is --dur-stream-lag: the most the reveal may trail the stream. */
  constructor(private readonly lagMs: number) {}

  /** The text the reader sees now: whole words only. */
  get visible(): string {
    return this.received.slice(0, this.released);
  }

  /** Everything received so far, released or not. */
  get text(): string {
    return this.received;
  }

  /** The stream has ended and every word is out. */
  get isSettled(): boolean {
    return this.ended && this.released >= this.received.trimEnd().length;
  }

  /**
   * The whole text so far, as the chat runtime reports it (it grows with each chunk). A text that no
   * longer starts with what was received replaced it, so the reveal starts over from it.
   */
  receive(text: string, now: number): void {
    if (!text.startsWith(this.received)) this.restart();
    if (text.length === this.received.length) return;
    if (this.lastChunk !== undefined) {
      const gap = (now - this.lastChunk) / 1000;
      this.gap = this.gap === 0 ? gap : this.gap * 0.7 + gap * 0.3;
    }
    this.lastChunk = now;
    this.received = text;
    this.arrivals.push({ end: text.length, at: now });
  }

  /** The model finished: the rest flushes quickly, still word by word. */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.flushRate = Math.max(this.rate, (this.received.length - this.shown) / (this.lagSeconds() * FLUSH_SHARE));
  }

  /** One animation frame: advances the reveal and returns the visible text. */
  tick(now: number): string {
    const dt = this.lastFrame === undefined ? 0 : Math.min(now - this.lastFrame, MAX_FRAME_S * 1000) / 1000;
    this.lastFrame = now;
    const backlog = this.received.length - this.shown;
    let target = backlog > 0 ? Math.max(MIN_RATE, backlog / this.lagSeconds()) : 0;
    if (this.ended) target = Math.max(target, this.flushRate);
    this.rate += (target - this.rate) * Math.min(1, dt * RATE_FOLLOW);
    if (backlog > 0) this.rate = Math.max(this.rate, MIN_RATE / 2, this.deadlineRate(now));
    this.shown = Math.min(this.received.length, Math.max(this.shown + this.rate * dt, this.overdue(now)));
    this.release(Math.floor(this.shown + 1e-6));
    return this.visible;
  }

  private lagSeconds(): number {
    const cap = this.lagMs / 1000;
    return Math.min(cap, Math.max(MIN_LAG_S, this.gap === 0 ? cap : this.gap));
  }

  /**
   * The rate that gets every waiting chunk out before it is a lag old, spread over the time it has left.
   * The eased rate usually beats it; on a sudden burst it lifts the rate at once, so the lag bound holds
   * without a frame that dumps the backlog.
   */
  private deadlineRate(now: number): number {
    let needed = 0;
    for (const arrival of this.arrivals) {
      const left = Math.max(MAX_FRAME_S / 4, (this.lagMs - (now - arrival.at)) / 1000);
      needed = Math.max(needed, (arrival.end - this.shown) / left);
    }
    return needed;
  }

  /** How far the reveal must be by now: every chunk that arrived at least the lag ago is out. */
  private overdue(now: number): number {
    while (this.arrivals.length > 0 && now - this.arrivals[0]!.at >= this.lagMs) {
      this.deadline = this.arrivals.shift()!.end;
    }
    return this.deadline;
  }

  /** Releases every whole word that ends at or before `upTo`. A word is whole once text follows it or the stream ended. */
  private release(upTo: number): void {
    for (;;) {
      const match = NEXT_WORD.exec(this.received.slice(this.released));
      if (match === null) return;
      const end = this.released + match[0].length;
      const isWhole = end < this.received.length || this.ended;
      if (!isWhole || end > upTo) return;
      this.released = end;
    }
  }

  private restart(): void {
    this.received = "";
    this.shown = 0;
    this.released = 0;
    this.rate = 0;
    this.lastChunk = undefined;
    this.gap = 0;
    this.ended = false;
    this.flushRate = 0;
    this.arrivals = [];
    this.deadline = 0;
  }
}
