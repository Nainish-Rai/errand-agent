// OpenUI's theme, built from the same semantic roles and type scale as everything else. This is the
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
import type { SemanticRole } from "@errand/design-tokens";

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
 * OpenUI's compound `font:` styles. Its defaults are 12-16px Inter; ours are the chat's scale
 * (--text-meta … --text-title), so a chip or a date picker reads like the rest of the thread.
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

const REGULAR = "400";
const HEAVY = "560";
const text = (weight: string, size: string, family = "var(--font-sans)") => `${weight} var(--${size})/1.35 ${family}`;

function textStyles(): Record<OpenUiTextStyle, string> {
  return {
    textLabelXs: text(REGULAR, "text-meta"),
    textLabelXsHeavy: text(HEAVY, "text-meta"),
    textLabelSm: text(REGULAR, "text-label"),
    textLabelSmHeavy: text(HEAVY, "text-label"),
    textLabelDefault: text(REGULAR, "text-label"),
    textLabelDefaultHeavy: text(HEAVY, "text-label"),
    textLabelLg: text(REGULAR, "text-body"),
    textLabelLgHeavy: text(HEAVY, "text-body"),
    textBodyXs: text(REGULAR, "text-meta"),
    textBodySm: text(REGULAR, "text-label"),
    textBodyDefault: text(REGULAR, "text-body"),
    textBodyDefaultHeavy: text(HEAVY, "text-body"),
    textBodyLg: text(REGULAR, "text-panel"),
    textHeadingXs: text(HEAVY, "text-body"),
    textHeadingSm: text(HEAVY, "text-panel"),
    textHeadingMd: text(HEAVY, "text-title"),
    textNumbersXs: text(REGULAR, "text-meta", "var(--font-mono)"),
    textNumbersSm: text(REGULAR, "text-label", "var(--font-mono)"),
    textNumbersDefault: text(REGULAR, "text-body", "var(--font-mono)"),
  };
}

const role = (name: SemanticRole) => `var(--${name})`;

export function buildOpenUiTheme(): OpenUiThemeOverrides {
  return {
    background: role("surface-canvas"),
    foreground: role("fg-emph"),
    popoverBackground: role("surface-raised"),
    sunk: role("surface-well"),
    sunkDeep: role("surface-well"),
    elevated: role("surface-card"),
    elevatedStrong: role("surface-raised"),
    overlay: role("scrim"),
    highlight: role("interactive-tint"),
    infoBackground: role("interactive-tint"),
    successBackground: role("ok-tint"),
    alertBackground: role("warn-tint"),
    dangerBackground: role("err-tint"),
    textNeutralPrimary: role("fg-emph"),
    textNeutralSecondary: role("fg-body"),
    textNeutralTertiary: role("fg-meta"),
    textNeutralLink: role("interactive"),
    // The brand orange is for the logo and the illustration only, so generated text never gets it.
    textBrand: role("fg-emph"),
    textAccentPrimary: role("fg-emph"),
    textSuccessPrimary: role("ok"),
    textAlertPrimary: role("warn"),
    textDangerPrimary: role("err"),
    textInfoPrimary: role("info"),
    // The shadcn bridge's --primary, so a generated Choose button matches every other primary button.
    interactiveAccentDefault: "var(--primary)",
    interactiveAccentHover: "color-mix(in oklab, var(--primary) 85%, transparent)",
    interactiveAccentPressed: "var(--primary)",
    interactiveAccentDisabled: role("surface-raised"),
    interactiveDestructiveDefault: role("err"),
    borderDefault: role("edge"),
    borderInteractive: role("edge-strong"),
    borderInteractiveEmphasis: role("edge-strong"),
    borderInteractiveSelected: role("interactive"),
    borderAccent: role("interactive"),
    borderInfo: role("info"),
    borderAlert: role("warn"),
    borderSuccess: role("ok"),
    borderDanger: role("err"),
    chatUserResponseBg: role("surface-raised"),
    chatUserResponseText: role("fg-emph"),
    defaultChartPalette: ["var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--cat-4)", "var(--cat-5)", "var(--cat-6)"],
    fontBody: "var(--font-sans)",
    fontHeading: "var(--font-sans)",
    fontLabel: "var(--font-sans)",
    fontCode: "var(--font-mono)",
    fontNumbers: "var(--font-mono)",
    radiusS: "var(--radius-1)",
    radiusM: "var(--radius-2)",
    radiusL: "var(--radius-3)",
    ...textStyles(),
  };
}

/** OpenUI's mode follows data-theme. Before the theme is known (server render), dark is the default. */
export function openUiMode(theme: Theme | undefined): "dark" | "light" {
  return theme ?? "dark";
}
