"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { THEME_STORAGE_KEY } from "./theme-init-script";

export type Theme = "dark" | "light";

type ThemeContextValue = {
  /** Unknown until mounted; the head script has already set data-theme by then. */
  readonly theme: Theme | undefined;
  readonly toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** Light is the default whatever the OS prefers; only the toggle picks dark, and the choice is saved. */
export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>();

  useEffect(() => setTheme(currentTheme()), []);

  const toggleTheme = useCallback(() => {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    try {
      // Light is the default, so saving it is the same as forgetting the choice.
      if (next === "dark") window.localStorage.setItem(THEME_STORAGE_KEY, next);
      else window.localStorage.removeItem(THEME_STORAGE_KEY);
    } catch {
      // Private mode: the choice lasts for this page only.
    }
    document.documentElement.dataset.theme = next;
    setTheme(next);
  }, []);

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === undefined) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
