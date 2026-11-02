// Renders the typed tokens as CSS custom properties. The output is `packages/design-tokens/tokens.css`,
// which the web app imports and both design-system checks read.
import { bridge, type BridgeValue } from "./bridge";
import { colorPrimitives, radius, space } from "./primitives";
import { semanticRoleNames, themes, type RoleValue, type ThemeName } from "./roles";
import { durations, easings, fonts, textSizes, weights } from "./type-and-motion";

const HEADER = `/* Errand design tokens: dark (default) + light. Geist + Geist Mono.
 *
 * GENERATED from the typed tokens in packages/design-tokens/src by \`pnpm tokens:build\`. Do not edit
 * this file: change the source and rebuild. \`pnpm check:tokens\` fails when this file is stale.
 *
 * Layers, read top to bottom (structure from observatory-ui, MIT):
 *   1. primitives: raw palette, spacing, radius. The only place a literal colour may appear.
 *   2. semantic roles: what components read: surfaces, edges, text, interactive, status tones and tints,
 *      brand, categorical chart palette, type scale. Each theme remaps the same role names.
 *   3. library bridge: shadcn variable names, read by the eve chat template, assistant-ui and agents-ui.
 *      OpenUI's theme and the mobile app read the same semantic roles (see DESIGN_SYSTEM.md).
 *   4. motion presets by job, zeroed under reduced motion.
 *
 * Theme: data-theme="light" | "dark" on <html> or on any subtree. The roles and the bridge are declared
 * on every theme selector, because a custom property resolves var() where it is declared: a nested
 * light panel must re-declare --primary, not inherit the dark value computed at the root.
 *
 * To re-theme, change primitives. To change meaning, change the semantic layer.
 * Components never introduce colours; add a semantic role first.
 */`;

const decl = (name: string, value: string | number) => `  --${name}: ${value};`;
const px = (value: number) => `${value}px`;
const varOf = (name: string) => `var(--${name})`;
const tint = (primitive: string, percent: number) => `color-mix(in oklab, ${varOf(primitive)} ${percent}%, transparent)`;

function roleCss(value: RoleValue): string {
  switch (value.kind) {
    case "ref":
      return varOf(value.primitive);
    case "alpha":
      return tint(value.primitive, value.percent);
    case "shadow":
      return `${value.geometry} ${tint(value.primitive, value.percent)}`;
  }
}

function bridgeCss(value: BridgeValue): string {
  switch (value.kind) {
    case "role":
      return varOf(value.role);
    case "primitive":
      return varOf(value.primitive);
    case "radius":
      return varOf(value.radius);
  }
}

function themeLines(theme: ThemeName): string[] {
  const roles = themes[theme];
  return [`  color-scheme: ${theme};`, ...semanticRoleNames.map((role) => decl(role, roleCss(roles[role])))];
}

function bridgeLines(): string[] {
  return Object.entries(bridge).map(([name, value]) => decl(name, bridgeCss(value)));
}

export function renderTokensCss(): string {
  const dark = [
    ":root,",
    '[data-theme="dark"] {',
    "  /* ---- primitives ---- */",
    ...Object.entries(colorPrimitives).map(([name, hex]) => decl(name, hex)),
    ...Object.entries(space).map(([name, value]) => decl(name, px(value))),
    ...Object.entries(radius).map(([name, value]) => decl(name, px(value))),
    "",
    "  /* ---- semantic roles (dark) ---- */",
    ...themeLines("dark"),
    "",
    ...Object.entries(fonts).map(([name, value]) => decl(name, value)),
    ...Object.entries(textSizes).map(([name, value]) => decl(name, px(value))),
    ...Object.entries(weights).map(([name, value]) => decl(name, value)),
    "",
    "  /* ---- library bridge (shadcn names; assistant-ui, agents-ui and the eve template read these) ---- */",
    ...bridgeLines(),
    "",
    "  /* ---- motion presets (by job) ---- */",
    ...Object.entries(easings).map(([name, value]) => decl(name, value)),
    ...Object.entries(durations).map(([name, ms]) => decl(name, `${ms}ms`)),
    "}",
  ];
  const light = [
    "/* ---- semantic roles (light): same names, light primitives ---- */",
    '[data-theme="light"] {',
    ...themeLines("light"),
    "",
    "  /* ---- library bridge, re-declared so it resolves against the light roles ---- */",
    ...bridgeLines(),
    "}",
  ];
  const reducedMotion = [
    "@media (prefers-reduced-motion: reduce) {",
    "  :root,",
    "  [data-theme] {",
    ...Object.keys(durations).map((name) => `  ${decl(name, "0ms")}`),
    "  }",
    "}",
  ];
  return [HEADER, ...dark, "", ...light, "", ...reducedMotion, ""].join("\n");
}
