"use client";

import { createTheme, ThemeProvider } from "@openuidev/react-ui";
import type { ReactNode } from "react";

import { useTheme } from "@/components/theme-provider";

import { buildOpenUiTheme, openUiMode } from "./openui-theme";

// OpenUI's theme for the whole chat, built from our semantic roles. One theme object serves both
// modes (every value is a var() of a role that data-theme switches); `mode` follows data-theme.

const theme = createTheme(buildOpenUiTheme());

export function GeneratedUiTheme({ children }: { readonly children: ReactNode }) {
  const { theme: mode } = useTheme();
  return (
    <ThemeProvider mode={openUiMode(mode)} lightTheme={theme} darkTheme={theme}>
      {children}
    </ThemeProvider>
  );
}
