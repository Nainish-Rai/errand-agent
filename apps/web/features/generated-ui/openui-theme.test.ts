import { themeNames, tokens } from "@errand/design-tokens";
import { describe, expect, it } from "vitest";

import { buildOpenUiTheme, type OpenUiThemeOverrides } from "./openui-theme";

// OpenUI's surfaces carry its text roles, so every surface we map must read against every text role
// we map, in both themes. Its `foreground` is one of those surfaces (tooltips, cards, menus): mapping
// it to ink drew the chart tooltip black on black in light mode.

const SURFACES = ["background", "foreground", "popoverBackground", "elevated", "elevatedStrong", "sunk"] as const;
const TEXT = ["textNeutralPrimary", "textNeutralSecondary"] as const;

function hexOf(theme: (typeof themeNames)[number], reference: string): string {
  const name = /^var\(--([a-z0-9-]+)\)$/.exec(reference)?.[1];
  const value = name === undefined ? undefined : (tokens[theme] as Readonly<Record<string, string>>)[name];
  if (value === undefined || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${reference} is not a solid hex token in ${theme}`);
  return value;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.039_28 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe("OpenUI theme mapping", () => {
  const theme: OpenUiThemeOverrides = buildOpenUiTheme();
  for (const mode of themeNames) {
    for (const surface of SURFACES) {
      for (const text of TEXT) {
        it(`${text} reads on ${surface} in ${mode} (at least 4.5:1)`, () => {
          expect(contrast(hexOf(mode, theme[surface]), hexOf(mode, theme[text]))).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }
});
