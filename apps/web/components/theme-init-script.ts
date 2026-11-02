// Shared by the server layout (which inlines the script) and the client ThemeProvider. Not a client
// module: a server component that imported a string from a "use client" file would get a reference.

export const THEME_STORAGE_KEY = "errand-theme";

/**
 * Runs in <head> before first paint, so the page never flashes the wrong theme: the saved choice if
 * there is one, otherwise the system setting. It is inlined as a string, so it must be self-contained.
 */
export const themeInitScript = `(() => {
  const root = document.documentElement;
  try {
    const stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    root.dataset.theme = stored === "light" || stored === "dark"
      ? stored
      : window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    root.dataset.theme = "dark";
  }
})();`;
