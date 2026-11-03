// OpenUI's theme, built from the same Lime roles and type scale as everything else. This is the
// one mapping module generated UI uses (generated-ui-theme.tsx):
//
//   const theme = createTheme(buildOpenUiTheme());
//   <ThemeProvider mode={openUiMode(useTheme().theme)} lightTheme={theme} darkTheme={theme}>
//
// Every value is a var() reference, so one object serves both modes: the roles behind it change with
// data-theme, and `mode` only tells OpenUI which of its own defaults sit underneath.
//
// Generated UI never gets the trust components' look or an Approve button: this folder may not import
// features/trust (enforced by `pnpm check:layers`).
import { tokens } from "@errand/design-tokens";

import type { Theme } from "@/components/theme-provider";

/** The subset of OpenUI's `Theme` (@openuidev/react-ui 0.18) that we drive. Key names are OpenUI's. */
export type OpenUiThemeOverrides = {
  readonly background: string;
  readonly foreground: string;
  readonly popoverBackground: string;
  readonly sunk: string;
  readonly sunkDeep: string;
  readonly elevated: string;
  readonly elevatedStrong: string;
  readonly overlay: string;
  readonly highlight: string;
  readonly infoBackground: string;
  readonly successBackground: string;
  readonly alertBackground: string;
  readonly dangerBackground: string;
  readonly textNeutralPrimary: string;
  readonly textNeutralSecondary: string;
  readonly textNeutralTertiary: string;
  readonly textNeutralLink: string;
  readonly textBrand: string;
  readonly textAccentPrimary: string;
  readonly textSuccessPrimary: string;
  readonly textAlertPrimary: string;
  readonly textDangerPrimary: string;
  readonly textInfoPrimary: string;
  readonly interactiveAccentDefault: string;
  readonly interactiveAccentHover: string;
  readonly interactiveAccentPressed: string;
  readonly interactiveAccentDisabled: string;
  readonly interactiveDestructiveDefault: string;
  readonly borderDefault: string;
  readonly borderInteractive: string;
  readonly borderInteractiveEmphasis: string;
  readonly borderInteractiveSelected: string;
  readonly borderAccent: string;
  readonly borderInfo: string;
  readonly borderAlert: string;
  readonly borderSuccess: string;
  readonly borderDanger: string;
  readonly chatUserResponseBg: string;
  readonly chatUserResponseText: string;
  readonly defaultChartPalette: string[];
  readonly fontBody: string;
  readonly fontHeading: string;
  readonly fontLabel: string;
  readonly fontCode: string;
  readonly fontNumbers: string;
  readonly radiusS: string;
  readonly radiusM: string;
  readonly radiusL: string;
} & Readonly<Record<OpenUiTextStyle, string>>;

/**
 * OpenUI's compound `font:` styles. Its defaults are 12-16px Inter; ours are Lime's scale
 * (--text-xs … --text-xl), so a chip or a date picker reads like the rest of the thread.
 */
type OpenUiTextStyle =
  | "textLabelXs"
  | "textLabelXsHeavy"
  | "textLabelSm"
  | "textLabelSmHeavy"
  | "textLabelDefault"
  | "textLabelDefaultHeavy"
  | "textLabelLg"
  | "textLabelLgHeavy"
  | "textBodyXs"
  | "textBodySm"
  | "textBodyDefault"
  | "textBodyDefaultHeavy"
  | "textBodyLg"
  | "textHeadingXs"
  | "textHeadingSm"
  | "textHeadingMd"
  | "textNumbersXs"
  | "textNumbersSm"
  | "textNumbersDefault";

const REGULAR = "var(--weight-normal)";
const HEAVY = "var(--weight-medium)";
const HEADING = "var(--weight-semibold)";
const text = (weight: string, size: string) => `${weight} var(--${size})/var(--leading-snug) var(--font-sans)`;

function textStyles(): Record<OpenUiTextStyle, string> {
  return {
    textLabelXs: text(REGULAR, "text-xs"),
    textLabelXsHeavy: text(HEAVY, "text-xs"),
    textLabelSm: text(REGULAR, "text-xs"),
    textLabelSmHeavy: text(HEAVY, "text-xs"),
    textLabelDefault: text(REGULAR, "text-sm"),
    textLabelDefaultHeavy: text(HEAVY, "text-sm"),
    textLabelLg: text(REGULAR, "text-sm"),
    textLabelLgHeavy: text(HEAVY, "text-sm"),
    textBodyXs: text(REGULAR, "text-xs"),
    textBodySm: text(REGULAR, "text-xs"),
    textBodyDefault: text(REGULAR, "text-sm"),
    textBodyDefaultHeavy: text(HEAVY, "text-sm"),
    textBodyLg: text(REGULAR, "text-base"),
    textHeadingXs: text(HEADING, "text-sm"),
    textHeadingSm: text(HEADING, "text-base"),
    textHeadingMd: text(HEADING, "text-lg"),
    // Figures are tabular Hanken Grotesk, not mono (Lime keeps mono for codes).
    textNumbersXs: text(REGULAR, "text-xs"),
    textNumbersSm: text(REGULAR, "text-xs"),
    textNumbersDefault: text(REGULAR, "text-sm"),
  };
}

/** A Lime role or Errand addition by name; an unknown name fails at load, so a typo never ships a blank colour. */
function role(name: string): string {
  if (!(name in tokens.light)) throw new Error(`--${name} is not a design token`);
  return `var(--${name})`;
}

export function buildOpenUiTheme(): OpenUiThemeOverrides {
  return {
    background: role("page"),
    foreground: role("fg"),
    popoverBackground: role("raised"),
    sunk: role("surface-2"),
    sunkDeep: role("surface-3"),
    elevated: role("surface"),
    elevatedStrong: role("raised"),
    overlay: role("scrim"),
    highlight: role("accent-wash"),
    // Lime has no info hue, so OpenUI's info tone is the quiet wash and the olive line.
    infoBackground: role("accent-wash"),
    successBackground: role("success-tint"),
    alertBackground: role("warn-tint"),
    dangerBackground: role("danger-tint"),
    textNeutralPrimary: role("fg"),
    textNeutralSecondary: role("fg-2"),
    textNeutralTertiary: role("fg-3"),
    textNeutralLink: role("fg"),
    textBrand: role("fg"),
    textAccentPrimary: role("fg"),
    textSuccessPrimary: role("success-text"),
    textAlertPrimary: role("warn-text"),
    textDangerPrimary: role("danger-text"),
    textInfoPrimary: role("fg-2"),
    // The lime, so a generated Choose button matches every other primary button.
    interactiveAccentDefault: role("accent"),
    interactiveAccentHover: role("accent-hover"),
    interactiveAccentPressed: role("accent-active"),
    interactiveAccentDisabled: role("surface-2"),
    interactiveDestructiveDefault: role("danger"),
    borderDefault: role("line"),
    borderInteractive: role("line-strong"),
    borderInteractiveEmphasis: role("control"),
    borderInteractiveSelected: role("accent-line"),
    borderAccent: role("accent-line"),
    borderInfo: role("accent-line"),
    borderAlert: role("warn"),
    borderSuccess: role("success"),
    borderDanger: role("danger"),
    chatUserResponseBg: role("surface-2"),
    chatUserResponseText: role("fg"),
    // Lime draws charts in ink only.
    defaultChartPalette: [role("ink"), role("fg-3")],
    fontBody: role("font-sans"),
    fontHeading: role("font-sans"),
    fontLabel: role("font-sans"),
    fontCode: role("font-mono"),
    fontNumbers: role("font-sans"),
    radiusS: role("radius-sm"),
    radiusM: role("radius-md"),
    radiusL: role("radius-field"),
    ...textStyles(),
  };
}

/** OpenUI's mode follows data-theme. Before the theme is known (server render), light is the default. */
export function openUiMode(theme: Theme | undefined): "dark" | "light" {
  return theme ?? "light";
}
