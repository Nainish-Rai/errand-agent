// Layer 2: semantic roles, what components read. Each theme maps the same role names onto primitives.
// To change meaning, change this layer. A new colour in a component means a new role here first.
import type { ColorPrimitive } from "./primitives";

/** A role is a primitive, a primitive at some opacity, or a shadow tinted by one. */
export type RoleValue =
  | { readonly kind: "ref"; readonly primitive: ColorPrimitive }
  | { readonly kind: "alpha"; readonly primitive: ColorPrimitive; readonly percent: number }
  | { readonly kind: "shadow"; readonly geometry: string; readonly primitive: ColorPrimitive; readonly percent: number };

const ref = (primitive: ColorPrimitive): RoleValue => ({ kind: "ref", primitive });
const alpha = (primitive: ColorPrimitive, percent: number): RoleValue => ({ kind: "alpha", primitive, percent });
const shadow = (geometry: string, primitive: ColorPrimitive, percent: number): RoleValue => ({
  kind: "shadow",
  geometry,
  primitive,
  percent,
});

export const semanticRoleNames = [
  "surface-well",
  "surface-canvas",
  "surface-card",
  "surface-raised",
  "surface-glass",
  "edge",
  "edge-strong",
  "edge-glass",
  "fg-emph",
  "fg-body",
  "fg-meta",
  "fg-faint",
  "interactive",
  "interactive-tint",
  "ok",
  "warn",
  "err",
  "info",
  "ok-tint",
  "warn-tint",
  "err-tint",
  "warn-fill",
  "on-warn-fill",
  "err-fill",
  "on-err-fill",
  "brand",
  "scrim",
  "shadow-pop",
  "hero-sky-top",
  "hero-sky-mid",
  "hero-building",
  "hero-window",
  "hero-cloud",
  "hero-road",
  "hero-title-shadow",
] as const;

export type SemanticRole = (typeof semanticRoleNames)[number];

/** Every theme defines every role, so a role can never be missing in one theme. */
export type ThemeRoles = { readonly [role in SemanticRole]: RoleValue };

export const themeNames = ["dark", "light"] as const;
export type ThemeName = (typeof themeNames)[number];

const dark: ThemeRoles = {
  "surface-well": ref("ink-0"),
  "surface-canvas": ref("ink-1"),
  "surface-card": ref("ink-2"),
  "surface-raised": ref("ink-3"),
  "surface-glass": alpha("ink-0", 55),
  edge: ref("ink-4"),
  "edge-strong": ref("ink-5"),
  "edge-glass": alpha("white", 8),
  "fg-emph": ref("ink-9"),
  "fg-body": ref("ink-8"),
  "fg-meta": ref("ink-7"),
  "fg-faint": ref("ink-6"),
  interactive: ref("blue-bright"),
  "interactive-tint": alpha("blue-bright", 15),
  ok: ref("green-bright"),
  warn: ref("amber-bright"),
  err: ref("red-bright"),
  info: ref("blue-bright"),
  "ok-tint": alpha("green-bright", 14),
  "warn-tint": alpha("amber-bright", 14),
  "err-tint": alpha("red-bright", 14),
  "warn-fill": ref("amber-bright"),
  "on-warn-fill": ref("on-amber"),
  "err-fill": ref("red-deep"),
  "on-err-fill": ref("on-red"),
  brand: ref("orange-bright"),
  scrim: alpha("black", 45),
  "shadow-pop": shadow("0 8px 24px", "black", 45),
  "hero-sky-top": ref("night-sky-top"),
  "hero-sky-mid": ref("night-sky-mid"),
  "hero-building": ref("night-building"),
  "hero-window": ref("night-window"),
  "hero-cloud": ref("night-cloud"),
  "hero-road": ref("night-road"),
  "hero-title-shadow": shadow("0 2px 12px", "black", 60),
};

const light: ThemeRoles = {
  "surface-well": ref("paper-well"),
  "surface-canvas": ref("paper-0"),
  "surface-card": ref("paper-1"),
  "surface-raised": ref("paper-2"),
  "surface-glass": alpha("paper-0", 72),
  edge: ref("paper-3"),
  "edge-strong": ref("paper-4"),
  "edge-glass": alpha("black", 8),
  "fg-emph": ref("paper-8"),
  "fg-body": ref("paper-7"),
  "fg-meta": ref("paper-6"),
  "fg-faint": ref("paper-5"),
  interactive: ref("blue-deep"),
  "interactive-tint": alpha("blue-deep", 12),
  ok: ref("green-deep"),
  warn: ref("amber-deep"),
  err: ref("red-deep"),
  info: ref("blue-deep"),
  "ok-tint": alpha("green-deep", 12),
  "warn-tint": alpha("amber-deep", 12),
  "err-tint": alpha("red-deep", 10),
  "warn-fill": ref("amber-bright"),
  "on-warn-fill": ref("on-amber"),
  "err-fill": ref("red-deep"),
  "on-err-fill": ref("on-red"),
  brand: ref("orange-deep"),
  scrim: alpha("black", 25),
  "shadow-pop": shadow("0 8px 24px", "black", 12),
  "hero-sky-top": ref("day-sky-top"),
  "hero-sky-mid": ref("day-sky-mid"),
  "hero-building": ref("day-building"),
  "hero-window": ref("day-window"),
  "hero-cloud": ref("day-cloud"),
  "hero-road": ref("day-road"),
  "hero-title-shadow": shadow("0 1px 10px", "white", 80),
};

export const themes: { readonly [theme in ThemeName]: ThemeRoles } = { dark, light };
