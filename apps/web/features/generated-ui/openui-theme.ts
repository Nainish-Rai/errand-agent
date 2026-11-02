// OpenUI's theme, built from the same semantic roles as everything else. OpenUI is not installed yet
// (ticket 17 adds it; @openuidev/react-ui pulls in d3, katex and react-markdown). This is the one
// mapping module it will use:
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
};

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
  };
}

/** OpenUI's mode follows data-theme. Before the theme is known (server render), dark is the default. */
export function openUiMode(theme: Theme | undefined): "dark" | "light" {
  return theme ?? "dark";
}
