// The design tokens as a typed object: `tokens.light` and `tokens.dark` hold every Lime role and Errand
// addition resolved to a concrete value, for clients that cannot read CSS (NativeWind, StyleSheet), and
// `motion` gives script animation the same durations and curves. The web reads the generated
// `@errand/design-tokens/tokens.css` instead.
import { errandColorExtensions, errandDarkFixes, errandMotionExtensions, errandReducedMotion } from "./errand";
import { limeDark, limeReducedMotion, limeScaleGroups, limeThemeGroups, type LimeGroup, type LimeToken } from "./lime";

export { errandColorExtensions, errandDarkFixes, errandMotionExtensions, errandReducedMotion, limeDark, limeReducedMotion, limeScaleGroups, limeThemeGroups };
export type { LimeGroup, LimeToken };
export { renderTokensCss } from "./css";

export const themeNames = ["light", "dark"] as const;
export type ThemeName = (typeof themeNames)[number];

type Values = Readonly<Record<string, string>>;

const entries = (tokens: readonly LimeToken[]): Values => Object.fromEntries(tokens.map(([name, value]) => [name, value]));
const scale = entries(limeScaleGroups.flatMap((group) => group.tokens));
const motionExtensions = entries(errandMotionExtensions);
const light = { ...entries(limeThemeGroups.flatMap((group) => group.tokens)), ...entries(errandColorExtensions) };
const dark = { ...light, ...entries(limeDark), ...entries(errandDarkFixes) };

/** Substitutes every var(--x) with x's own resolved value, as the browser does where the role is declared. */
function resolveValue(value: string, values: Values, seen: readonly string[] = []): string {
  return value.replace(/var\(--([\w-]+)\)/g, (_, name: string) => {
    if (seen.includes(name)) throw new Error(`token cycle at --${name}`);
    const next = values[name];
    if (next === undefined) throw new Error(`undefined token --${name}`);
    return resolveValue(next, values, [...seen, name]);
  });
}

function resolveTheme(values: Values): Values {
  const all = { ...scale, ...motionExtensions, ...values };
  return Object.fromEntries(Object.keys(all).map((name) => [name, resolveValue(all[name] as string, all)]));
}

/** A duration token in milliseconds, e.g. `ms("dur-base")` is 200. Zero it yourself under reduced motion. */
function ms(name: string): number {
  const value = scale[name] ?? motionExtensions[name];
  const match = value?.match(/^(\d+)ms$/);
  if (!match) throw new Error(`--${name} is not a duration`);
  return Number(match[1]);
}

/** A curve token as the four numbers motion libraries take, e.g. `curve("ease-out")`. */
function curve(name: string): readonly [number, number, number, number] {
  const match = scale[name]?.match(/^cubic-bezier\(([^)]+)\)$/);
  if (!match) throw new Error(`--${name} is not a cubic-bezier curve`);
  const [a, b, c, d] = (match[1] as string).split(",").map(Number);
  return [a as number, b as number, c as number, d as number];
}

export const motion = {
  instant: ms("dur-instant"),
  fast: ms("dur-fast"),
  base: ms("dur-base"),
  slow: ms("dur-slow"),
  spin: ms("dur-spin"),
  streamWord: ms("dur-stream-word"),
  streamLag: ms("dur-stream-lag"),
  easeOut: curve("ease-out"),
  easeIn: curve("ease-in"),
} as const;

export const tokens = { light: resolveTheme(light), dark: resolveTheme(dark) } as const;
