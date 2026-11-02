import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { bridge, colorPrimitives, renderTokensCss, semanticRoleNames, themeNames, tokens, type BridgeName, type SemanticRole } from "./index";

const committedCss = readFileSync(new URL("../tokens.css", import.meta.url), "utf8");

describe("design tokens", () => {
  it("the committed tokens.css is exactly what the typed tokens generate", () => {
    expect(committedCss).toBe(renderTokensCss());
  });

  it("every theme resolves every role and bridge name to a concrete value", () => {
    const names = [...semanticRoleNames, ...(Object.keys(bridge) as BridgeName[])] as (SemanticRole | BridgeName)[];
    for (const theme of themeNames) {
      for (const name of names) {
        expect(tokens[theme][name], `${theme} ${name}`).toMatch(/#[0-9a-f]{6}|\dpx$/);
      }
    }
  });

  it("a tint resolves to its primitive at the same opacity", () => {
    expect(tokens.dark["surface-glass"]).toBe(`${colorPrimitives["ink-0"]}8c`);
    expect(tokens.light["err-tint"]).toBe(`${colorPrimitives["red-deep"]}1a`);
  });

  it("literal colours appear only in the primitives block of the generated CSS", () => {
    const afterPrimitives = committedCss.slice(committedCss.indexOf("/* ---- semantic roles (dark)"));
    expect(afterPrimitives).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("every duration is zeroed under reduced motion", () => {
    const reduced = committedCss.slice(committedCss.indexOf("@media (prefers-reduced-motion: reduce)"));
    for (const name of Object.keys(tokens.durations)) {
      expect(reduced).toContain(`--${name}: 0ms;`);
    }
  });
});
