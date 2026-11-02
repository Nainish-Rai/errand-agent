"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { THEME_STORAGE_KEY } from "./theme-init-script";

export type Theme = "dark" | "light";

/** Where the theme came from: the system setting, until the user picks one. */
export type ThemeSource = "system" | "user";

type ThemeContextValue = {
  /** Unknown until mounted; the head script has already set data-theme by then. */
  readonly theme: Theme | undefined;
  readonly source: ThemeSource;
  readonly toggleTheme: () => void;
  readonly followSystem: () => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function readStoredTheme(): Theme | undefined {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : undefined;
  } catch {
    return undefined;
  }
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>();
  const [source, setSource] = useState<ThemeSource>("system");

  useEffect(() => {
    const stored = readStoredTheme();
    setSource(stored === undefined ? "system" : "user");
    setTheme(stored ?? systemTheme());
  }, []);

  // Follow the system setting until the user picks a theme.
  useEffect(() => {
    if (source !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const follow = () => {
      const next = systemTheme();
      applyTheme(next);
      setTheme(next);
    };
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, [source]);

  const toggleTheme = useCallback(() => {
    const current = (document.documentElement.dataset.theme as Theme | undefined) ?? systemTheme();
    const next: Theme = current === "dark" ? "light" : "dark";
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private mode: the choice lasts for this page only.
    }
    applyTheme(next);
    setTheme(next);
    setSource("user");
  }, []);

  const followSystem = useCallback(() => {
    try {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } catch {
      // Nothing stored to remove.
    }
    const next = systemTheme();
    applyTheme(next);
    setTheme(next);
    setSource("system");
  }, []);

  const value = useMemo(() => ({ theme, source, toggleTheme, followSystem }), [theme, source, toggleTheme, followSystem]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === undefined) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
