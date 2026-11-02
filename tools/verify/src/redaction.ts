// Keys and tokens never reach a log, a report or the terminal. Known secret values are removed
// verbatim; common key shapes are removed by pattern in case a value was never registered.

const PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, "[JWT REDACTED]"],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, "[KEY REDACTED]"],
  [/\b((?:x-)?api[_-]?key|authorization|token|secret)(["']?\s*[:=]\s*["']?)[^\s"',}]{8,}/gi, "$1$2[REDACTED]"],
];

export class Redactor {
  readonly #secrets = new Set<string>();

  /** Registers a secret value; values shorter than 8 characters would redact ordinary words. */
  addSecret(value: string | undefined): void {
    if (value !== undefined && value.trim().length >= 8) this.#secrets.add(value.trim());
  }

  redact(text: string): string {
    let result = text;
    for (const secret of [...this.#secrets].sort((a, b) => b.length - a.length)) result = result.split(secret).join("[REDACTED]");
    for (const [pattern, replacement] of PATTERNS) result = result.replace(pattern, replacement);
    return result;
  }
}
