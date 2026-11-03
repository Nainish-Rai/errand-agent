// Renders the typed tokens as CSS custom properties. The output is `packages/design-tokens/tokens.css`,
// which the web app imports and both design-system checks read.
import { errandColorExtensions, errandDarkFixes, errandMotionExtensions, errandReducedMotion } from "./errand";
import { legacyAliases, legacyScaleAliases } from "./legacy";
import { limeDark, limeReducedMotion, limeScaleGroups, limeThemeGroups, type LimeToken } from "./lime";

const HEADER = `/* Errand design tokens: Lime (design-system/design-system-v3.html), light by default, dark behind the toggle.
 *
 * GENERATED from the typed tokens in packages/design-tokens/src by \`pnpm tokens:build\`. Do not edit
 * this file: change the source and rebuild. \`pnpm check:tokens\` fails when this file is stale.
 *
 * Read top to bottom:
 *   1. the lime source: Lime's roles and scale, verbatim. The only place a raw value may appear.
 *   2. Errand's additions: three colour aliases, two streaming durations and two dark contrast fixes.
 *
 * Theme: data-theme="light" | "dark" on <html> or on any subtree. Every role that is a var() is declared
 * on every theme selector, because a custom property resolves var() where it is declared: a nested dark
 * panel must re-declare --ring, not inherit the light value computed at the root.
 */`;

// Lime's own selectors, plus :root and a bare data-theme so the app and a nested panel pick a theme.
const LIGHT = ':root, [data-theme="light"], [data-system="lime"], .lime';
const DARK = '[data-theme="dark"], [data-system="lime"][data-theme="dark"], .lime[data-theme="dark"]';
const EVERY_THEME = ":root, [data-theme], :where(.lime)";

const decl = ([name, value, note]: LimeToken) => `  --${name}: ${value};${note ? ` /* ${note} */` : ""}`;
const aliasLines = (aliases: Readonly<Record<string, string>>) =>
  Object.entries(aliases).map(([name, value]) => decl([name, value, ""]));

const lightTokens: readonly LimeToken[] = limeThemeGroups.flatMap((group) => group.tokens);
const darkNames = new Set<string>(limeDark.map(([name]) => name));
/** Light roles that are a var() and that dark does not redefine: re-declared so they resolve in dark. */
const darkRedeclared = lightTokens.filter(([name, value]) => value.includes("var(") && !darkNames.has(name));

function rule(selector: string, lines: readonly string[]): string[] {
  return [`${selector} {`, ...lines, "}"];
}

export function renderTokensCss(): string {
  const lime = [
    "/* ---- lime source: Lime's tokens verbatim (last-updated 2026-11-02). Raw values are allowed only between",
    "   this line and the end marker. */",
    ...rule(LIGHT, [
      "  color-scheme: light;",
      ...limeThemeGroups.flatMap((group) => [`  /* == ${group.title} == */`, ...group.tokens.map(decl), ""]).slice(0, -1),
    ]),
    "",
    "/* The dark theme redefines the roles. The lime steps down a little in lightness and saturation so it does not glare",
    "   on a near-black page, and black stays the text on it. */",
    ...rule(DARK, ["  color-scheme: dark;", ...limeDark.map(decl), ...darkRedeclared.map(decl)]),
    "",
    ...rule(":root", limeScaleGroups.flatMap((group) => [`  /* == ${group.title} == */`, ...group.tokens.map(decl), ""]).slice(0, -1)),
    "",
    "/* Reduced motion zeroes every duration except the spinner, which is the only signal that work is running. */",
    "@media (prefers-reduced-motion: reduce) {",
    ...rule(":root", limeReducedMotion.map(decl)).map((line) => `  ${line}`),
    "}",
    "/* ---- end lime source */",
  ];
  const errand = [
    "/* ---- Errand additions: no raw values below this line. */",
    "/* Lime has no equivalent for these ideas, so they alias Lime roles and add no value. */",
    ...rule(EVERY_THEME, errandColorExtensions.map(decl)),
    "",
    ...rule(":root", errandMotionExtensions.map(decl)),
    "@media (prefers-reduced-motion: reduce) {",
    ...rule(":root", errandReducedMotion.map(decl)).map((line) => `  ${line}`),
    "}",
    "",
    "/* Errand fix for two Lime dark values that fall under AA with the dark --on-danger (see packages/design-tokens/src/errand.ts). */",
    ...rule(DARK, errandDarkFixes.map(decl)),
  ];
  const legacy = [
    "/* ---- v2 names, pointed at the Lime role that took each job (expand step; removed once nothing reads them). */",
    ...rule(":root, [data-theme]", aliasLines(legacyAliases)),
    "",
    ...rule(":root", aliasLines(legacyScaleAliases)),
  ];
  return [HEADER, ...lime, "", ...errand, "", ...legacy, ""].join("\n");
}
