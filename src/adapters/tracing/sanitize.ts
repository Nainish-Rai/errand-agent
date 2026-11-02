import type { TraceValue } from "../../core/ports/trace-sink";

// Everything a trace keeps passes through here first: tool arguments and results, model output,
// errors. Phone numbers, email addresses and keys never reach the file. Redaction is by pattern
// (in any string, at any depth), by field name (a field called `apiKey` or `phone` is redacted
// whatever it holds) and by value (the runtime secrets the process knows, such as the MiniMax key).

export const REDACTED = {
  email: "[redacted:email]",
  phone: "[redacted:phone]",
  key: "[redacted:key]",
} as const;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

// Indian mobiles (+91 98765 43210, 098765-43210, 9876543210), Bengaluru landlines (080 4123 4567)
// and any other number written in international form (+44 20 7946 0958). Digit boundaries keep
// ISO dates, slot times, prices and ids intact.
const PHONE = new RegExp(
  [
    String.raw`(?<![\d+])(?:\+91[\s.-]?|0)?[6-9]\d{4}[\s.-]?\d{5}(?!\d)`,
    String.raw`(?<![\d+])(?:\+91[\s.-]?|0)80[\s.-]?\d{4}[\s.-]?\d{4}(?!\d)`,
    String.raw`(?<![\d+])\+\d{1,3}(?:[\s.-]?\d){7,13}(?!\d)`,
  ].join("|"),
  "g",
);

// Well-known credential shapes, then `name=value` / `name: value` pairs whose name says secret.
const KEY_SHAPES: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/g, // OpenAI, Anthropic, MiniMax-style secret keys
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWTs
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, // AWS access key ids
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g, // GitHub tokens
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack tokens
];
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi;
const NAMED_SECRET =
  /\b(api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd|token)(["']?\s*[:=]\s*["']?)[^\s"',;&}]{6,}/gi;

// Field names whose value is redacted outright: a delimited name in any case (`api_key`,
// `x-api-key`, `Authorization`) or a camelCase suffix (`minimaxApiKey`). Anchored at the end so
// `input_tokens` and `tokenCount` stay readable.
const SECRET_FIELD =
  /(?:^|[_.-])(?:api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|client[_-]?secret|password|passwd|authorization|cookie|credentials?)$/i;
const SECRET_FIELD_CAMEL = /[a-z0-9](?:ApiKey|AccessToken|AuthToken|RefreshToken|IdToken|Token|ClientSecret|Secret|Password)$/;
const PHONE_FIELD = /(?:^|[_.-])(?:phone|mobile|tel|telephone|msisdn|whatsapp)(?:[_.-]?(?:number|no))?$/i;
const PHONE_FIELD_CAMEL = /[a-z0-9](?:Phone|PhoneNumber|Mobile|MobileNumber)$/;
const EMAIL_FIELD = /(?:^|[_.-])e-?mail(?:[_.-]?address)?$/i;
const EMAIL_FIELD_CAMEL = /[a-z0-9](?:Email|EmailAddress)$/;

function isSecretField(field: string): boolean {
  return SECRET_FIELD.test(field) || SECRET_FIELD_CAMEL.test(field);
}

function isPhoneField(field: string): boolean {
  return PHONE_FIELD.test(field) || PHONE_FIELD_CAMEL.test(field);
}

function isEmailField(field: string): boolean {
  return EMAIL_FIELD.test(field) || EMAIL_FIELD_CAMEL.test(field);
}

const MIN_SECRET_LENGTH = 8;
const MAX_DEPTH = 32;

export interface SanitizeOptions {
  /** Exact values to remove wherever they appear, such as API keys read from the environment. */
  readonly secrets?: readonly (string | undefined)[];
}

export class Sanitizer {
  readonly #secrets: readonly string[];

  constructor(options: SanitizeOptions = {}) {
    this.#secrets = (options.secrets ?? [])
      .filter((secret): secret is string => secret !== undefined && secret.trim().length >= MIN_SECRET_LENGTH)
      .map((secret) => secret.trim())
      // Longest first, so a secret that contains another is removed whole.
      .sort((a, b) => b.length - a.length);
  }

  /** A redacted deep copy. Anything that isn't JSON (functions, symbols) is dropped. */
  sanitize(value: unknown): TraceValue {
    return this.#value(value, 0, new WeakSet());
  }

  sanitizeText(text: string): string {
    let clean = text;
    for (const secret of this.#secrets) clean = clean.replaceAll(secret, REDACTED.key);
    for (const shape of KEY_SHAPES) clean = clean.replace(shape, REDACTED.key);
    clean = clean.replace(BEARER, (_match, scheme: string) => `${scheme} ${REDACTED.key}`);
    clean = clean.replace(NAMED_SECRET, (_match, name: string, separator: string) => `${name}${separator}${REDACTED.key}`);
    clean = clean.replace(EMAIL, REDACTED.email);
    clean = clean.replace(PHONE, REDACTED.phone);
    return clean;
  }

  #value(value: unknown, depth: number, seen: WeakSet<object>): TraceValue {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return this.sanitizeText(value);
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "boolean") return value;
    if (typeof value === "bigint") return value.toString();
    if (typeof value !== "object") return null;
    if (depth >= MAX_DEPTH || seen.has(value)) return "[truncated]";
    seen.add(value);
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) return { name: value.name, message: this.sanitizeText(value.message) };
    if (Array.isArray(value)) return value.map((item) => this.#value(item, depth + 1, seen));
    const copy: Record<string, TraceValue> = {};
    for (const [field, item] of Object.entries(value)) {
      if (typeof item === "function" || typeof item === "symbol" || item === undefined) continue;
      copy[field] = this.#field(field, item, depth, seen);
    }
    return copy;
  }

  #field(field: string, item: unknown, depth: number, seen: WeakSet<object>): TraceValue {
    const isScalar = typeof item === "string" || typeof item === "number";
    if (item !== null && isSecretField(field)) return REDACTED.key;
    if (isScalar && isPhoneField(field)) return REDACTED.phone;
    if (isScalar && isEmailField(field)) return REDACTED.email;
    return this.#value(item, depth + 1, seen);
  }
}
