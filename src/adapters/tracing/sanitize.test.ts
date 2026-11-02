import { describe, expect, it } from "vitest";

import { REDACTED, Sanitizer } from "./sanitize";

// A made-up key in MiniMax's shape. Never a real one.
const FAKE_MINIMAX_KEY = "sk-api-FAKEfakeFAKE0123456789abcdefABCDEF";

describe("the trace sanitiser", () => {
  const sanitizer = new Sanitizer({ secrets: [FAKE_MINIMAX_KEY] });

  it("removes phone numbers written the ways people in Bengaluru write them", () => {
    const text =
      "Call me on +91 98765 43210, or 098765-43210, or 9876543210. Office: 080 4123 4567. UK: +44 20 7946 0958.";
    const clean = sanitizer.sanitizeText(text);
    expect(clean).not.toMatch(/\d{4}/);
    expect(clean.match(/\[redacted:phone\]/g)).toHaveLength(5);
  });

  it("removes email addresses", () => {
    expect(sanitizer.sanitizeText("Mail priya.rao+home@example.co.in today")).toBe(`Mail ${REDACTED.email} today`);
  });

  it("removes the runtime API key wherever it appears, and other key shapes", () => {
    const clean = sanitizer.sanitize({
      note: `the key is ${FAKE_MINIMAX_KEY}`,
      header: "Authorization: Bearer abcdefghijklmnop1234567890",
      query: "https://api.example.com/v1?api_key=abcd1234efgh5678&q=plumber",
      jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    });
    const written = JSON.stringify(clean);
    expect(written).not.toContain(FAKE_MINIMAX_KEY);
    expect(written).not.toContain("abcdefghijklmnop1234567890");
    expect(written).not.toContain("abcd1234efgh5678");
    expect(written).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(written).toContain("q=plumber");
  });

  it("removes a runtime secret that has no recognisable shape", () => {
    const opaque = "Zq81xVt0pLmN4rS7wYb2";
    const clean = new Sanitizer({ secrets: [opaque] }).sanitizeText(`retrying with ${opaque} now`);
    expect(clean).toBe(`retrying with ${REDACTED.key} now`);
  });

  it("redacts fields named for secrets, phones and emails, at any depth", () => {
    const clean = sanitizer.sanitize({
      customer: { name: "Priya", phone: 9876543210, contactEmail: "p@x.io", minimaxApiKey: "anything-at-all" },
      headers: { "x-api-key": "short", authorization: "whatever" },
      tokens: [{ token: "t0k3n-value" }],
    });
    expect(clean).toEqual({
      customer: { name: "Priya", phone: REDACTED.phone, contactEmail: REDACTED.email, minimaxApiKey: REDACTED.key },
      headers: { "x-api-key": REDACTED.key, authorization: REDACTED.key },
      tokens: [{ token: REDACTED.key }],
    });
  });

  it("keeps what the trace is for: ids, prices, ratings, dates, slots and token counts", () => {
    const toolResult = {
      kind: "found",
      providers: [
        {
          id: "prv_plumber_koramangala_1",
          priceInr: 949,
          rating: 4.3,
          reviewCount: 23,
          freeSlots: [{ start: "2026-11-03T17:00:00+05:30", end: "2026-11-03T18:00:00+05:30" }],
        },
      ],
      date_range: { from: "2026-11-03", to: "2026-11-09" },
      usage: { input_tokens: 1909, outputTokens: 40, maxTokens: 16384 },
      session: "wrun_01M6F677NS5JJZSGR24Z2B9QCK",
    };
    expect(sanitizer.sanitize(toolResult)).toEqual(toolResult);
  });

  it("turns values JSON can't hold into JSON", () => {
    const cyclic: Record<string, unknown> = { at: new Date("2026-11-03T00:00:00Z"), big: 10n, fn: () => 1 };
    cyclic.self = cyclic;
    expect(sanitizer.sanitize(cyclic)).toEqual({ at: "2026-11-03T00:00:00.000Z", big: "10", self: "[truncated]" });
    expect(sanitizer.sanitize(new Error("mail a@b.co failed"))).toEqual({
      name: "Error",
      message: `mail ${REDACTED.email} failed`,
    });
  });
});
