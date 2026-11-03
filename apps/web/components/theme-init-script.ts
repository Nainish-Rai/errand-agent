// Shared by the server layout (which inlines the script) and the client ThemeProvider. Not a client
// module: a server component that imported a string from a "use client" file would get a reference.

export const THEME_STORAGE_KEY = "errand-theme";

/**
 * Runs in <head> before first paint, so the page never flashes the wrong theme. Light is the default
 * whatever the OS prefers (design system v3): prefers-color-scheme is never read. Dark is only behind
 * the toggle, and a toggled choice is saved. The server already renders data-theme="light", so a page
 * with nothing saved never changes theme at all. It is inlined as a string, so it must be self-contained.
 */
export const themeInitScript = `(() => {
  try {
    if (localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}) === "dark") document.documentElement.dataset.theme = "dark";
  } catch {
    // Storage is blocked: stay light.
  }
})();`;
