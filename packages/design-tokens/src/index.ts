// The design tokens as a typed object: `tokens.dark` and `tokens.light` hold every semantic role and
// bridge name resolved to a concrete colour, for clients that cannot read CSS (NativeWind, StyleSheet).
// The web reads the generated `@errand/design-tokens/tokens.css` instead.
import { bridge, type BridgeName, type BridgeValue } from "./bridge";
import { colorPrimitives, radius, space, type ColorPrimitive } from "./primitives";
import { semanticRoleNames, themeNames, themes, type RoleValue, type SemanticRole, type ThemeName } from "./roles";
import { durations, easings, fonts, textSizes, weights } from "./type-and-motion";

export { bridge, colorPrimitives, durations, easings, fonts, radius, semanticRoleNames, space, textSizes, themeNames, themes, weights };
export type { BridgeName, BridgeValue, ColorPrimitive, RoleValue, SemanticRole, ThemeName };
export { renderTokensCss } from "./css";

export type ResolvedTheme = { readonly [name in SemanticRole | BridgeName]: string };

/** `color-mix(in oklab, C p%, transparent)` is C at alpha p, so it resolves to an 8-digit hex. */
function withAlpha(primitive: ColorPrimitive, percent: number): string {
  const alphaByte = Math.round((percent / 100) * 255);
  return colorPrimitives[primitive] + alphaByte.toString(16).padStart(2, "0");
}

function resolveRole(value: RoleValue): string {
  switch (value.kind) {
    case "ref":
      return colorPrimitives[value.primitive];
    case "alpha":
      return withAlpha(value.primitive, value.percent);
    case "shadow":
      return `${value.geometry} ${withAlpha(value.primitive, value.percent)}`;
  }
}

function resolveBridge(value: BridgeValue, roles: Record<SemanticRole, string>): string {
  switch (value.kind) {
    case "role":
      return roles[value.role];
    case "primitive":
      return colorPrimitives[value.primitive];
    case "radius":
      return `${radius[value.radius]}px`;
  }
}

function resolveTheme(theme: ThemeName): ResolvedTheme {
  const roles = Object.fromEntries(semanticRoleNames.map((role) => [role, resolveRole(themes[theme][role])])) as Record<
    SemanticRole,
    string
  >;
  const bridged = Object.fromEntries(
    Object.entries(bridge).map(([name, value]: [string, BridgeValue]) => [name, resolveBridge(value, roles)]),
  ) as Record<BridgeName, string>;
  return { ...roles, ...bridged };
}

export const tokens = {
  dark: resolveTheme("dark"),
  light: resolveTheme("light"),
  space,
  radius,
  fonts,
  textSizes,
  weights,
  easings,
  durations,
} as const;
