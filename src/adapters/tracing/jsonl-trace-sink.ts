import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { TraceAttributes, TraceRecord, TraceSink, TraceValue } from "../../core/ports/trace-sink";
import type { Sanitizer } from "./sanitize";

// One JSONL file per root session, `<directory>/<sessionId>.jsonl`, one record per line. The
// directory is outside git (`traces/*.jsonl` is ignored). Every record is sanitised before it is
// written, so nothing downstream (the trace route, the observatory export) sees raw content.

export const TRACE_SCHEMA = "errand.trace/1";

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export class InvalidTraceIdError extends Error {
  constructor(traceId: string) {
    super(`Not a trace id: ${JSON.stringify(traceId.slice(0, 40))}`);
    this.name = "InvalidTraceIdError";
  }
}

function isRecord(value: TraceValue): value is { readonly [key: string]: TraceValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface JsonlTraceSinkOptions {
  readonly directory: string;
  readonly sanitizer: Sanitizer;
}

export class JsonlTraceSink implements TraceSink {
  readonly #directory: string;
  readonly #sanitizer: Sanitizer;
  // Appends to one file run one after another, so lines never interleave and stay in call order.
  readonly #tails = new Map<string, Promise<void>>();

  constructor(options: JsonlTraceSinkOptions) {
    this.#directory = options.directory;
    this.#sanitizer = options.sanitizer;
  }

  fileFor(traceId: string): string {
    if (!SAFE_ID.test(traceId)) throw new InvalidTraceIdError(traceId);
    return path.join(this.#directory, `${traceId}.jsonl`);
  }

  async record(record: TraceRecord): Promise<void> {
    const file = this.fileFor(record.traceId);
    const line = `${JSON.stringify({ schema: TRACE_SCHEMA, ...this.#clean(record) })}\n`;
    const written = (this.#tails.get(file) ?? Promise.resolve()).then(() => this.#append(file, line));
    this.#tails.set(
      file,
      written.catch(() => undefined),
    );
    await written;
  }

  async read(traceId: string): Promise<readonly TraceRecord[]> {
    const file = this.fileFor(traceId);
    await this.#tails.get(file);
    const text = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    return text.split("\n").flatMap((line) => this.#parse(line));
  }

  async #append(file: string, line: string): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    await appendFile(file, line, "utf8");
  }

  #clean(record: TraceRecord): TraceRecord {
    const attributes: Record<string, TraceValue> = {};
    for (const [key, value] of Object.entries(record.attributes)) attributes[key] = this.#sanitizer.sanitize(value);
    return { ...record, name: this.#sanitizer.sanitizeText(record.name), attributes: attributes as TraceAttributes };
  }

  /** A line cut short by a crash mid-write is skipped rather than failing the whole trace. */
  #parse(line: string): TraceRecord[] {
    if (line.trim() === "") return [];
    try {
      const parsed = JSON.parse(line) as TraceValue;
      if (!isRecord(parsed) || parsed.schema !== TRACE_SCHEMA) return [];
      if (parsed.type !== "span" && parsed.type !== "event") return [];
      const { schema: _schema, ...record } = parsed;
      return [record as unknown as TraceRecord];
    } catch {
      return [];
    }
  }
}
