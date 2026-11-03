"use client";

import { Moon, Sun } from "lucide-react";

import { useTheme } from "./theme-provider";
import { Button } from "./ui/button";

/** Switches between light (the default) and dark; a dark choice is saved. */
export function ThemeToggle({ className }: { readonly className?: string }) {
  const { theme, toggleTheme } = useTheme();
  // Unknown until mounted; the icons follow data-theme through CSS, so nothing flashes.
  const label = theme === undefined ? "Switch theme" : `Switch to ${theme === "dark" ? "light" : "dark"} theme`;
  return (
    <Button aria-label={label} title={label} size="icon" variant="ghost" onClick={toggleTheme} className={className}>
      <Sun aria-hidden className="hidden dark:block" />
      <Moon aria-hidden className="block dark:hidden" />
    </Button>
  );
}
