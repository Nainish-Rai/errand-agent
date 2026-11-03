import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  errandColorExtensions,
  errandDarkFixes,
  errandMotionExtensions,
  limeDark,
  limeScaleGroups,
  limeThemeGroups,
  motion,
  renderTokensCss,
  themeNames,
  tokens,
  type LimeToken,
} from "./index";

const committedCss = readFileSync(new URL("../tokens.css", import.meta.url), "utf8");
const v3 = readFileSync(new URL("../../../design-system/design-system-v3.html", import.meta.url), "utf8");

/** The declarations of the first rule after `selector` (from `from`), as v3 writes them. */
function v3Block(selector: string, from = 0): Record<string, string> {
  const start = v3.indexOf(selector, from);
  const body = v3.slice(v3.indexOf("{", start) + 1, v3.indexOf("\n}", start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!.slice(2), m[2]!.trim()]));
}
const asRecord = (list: readonly LimeToken[]) => Object.fromEntries(list.map(([name, value]) => [name, value]));
const limeEnd = v3.indexOf("/* ---- end lime source");

describe("design tokens", () => {
  it("the committed tokens.css is exactly what the typed tokens generate", () => {
    expect(committedCss).toBe(renderTokensCss());
  });

  it("the light, scale and dark tokens are v3's lime source, value for value", () => {
    const light = asRecord([...limeThemeGroups, ...limeScaleGroups].flatMap((group) => group.tokens));
    expect(light).toEqual(v3Block('[data-system="lime"], .lime {'));
    expect(asRecord(limeDark)).toEqual(v3Block('[data-system="lime"][data-theme="dark"]'));
  });

  it("Errand's additions and the two dark fixes are v3's, value for value", () => {
    expect(asRecord([...errandColorExtensions, ...errandMotionExtensions])).toEqual(v3Block(":where(.lime) {"));
    expect(asRecord(errandDarkFixes)).toEqual(v3Block('[data-system="lime"][data-theme="dark"]', limeEnd));
  });

  it("every theme resolves every token to a value with no var() left", () => {
    for (const theme of themeNames) {
      for (const [name, value] of Object.entries(tokens[theme])) {
        expect(value, `${theme} ${name}`).not.toContain("var(");
      }
    }
    expect(tokens.dark["danger-hover"]).toBe(tokens.dark.danger);
    expect(tokens.dark["errand-on-ok-fill"]).toBe(tokens.dark.page);
  });

  it("raw colours appear only inside the lime source region of the generated CSS", () => {
    const outside = committedCss.slice(committedCss.indexOf("/* ---- end lime source"));
    expect(outside).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/);
  });

  it("reduced motion zeroes every duration but the spinner's and the stream lag", () => {
    const reduced = [...committedCss.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join("");
    const durations = Object.keys(tokens.light).filter((name) => name.startsWith("dur-"));
    for (const name of durations) {
      if (name === "dur-spin" || name === "dur-stream-lag") expect(reduced).not.toContain(`--${name}:`);
      else expect(reduced, name).toContain(`--${name}: 0ms;`);
    }
  });

  it("script motion reads the same durations and curves", () => {
    expect(motion).toMatchObject({ instant: 80, fast: 140, base: 200, slow: 280, spin: 900, streamWord: 240, streamLag: 400 });
    expect(motion.easeOut).toEqual([0.16, 1, 0.3, 1]);
  });
});
