// Type scale and motion presets. Theme-independent.

export const fonts = {
  "font-sans": '"Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  "font-mono": '"Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
} as const;

/** Pixel sizes. Words are set in Geist; numbers, times and IDs in Geist Mono with tabular figures. */
export const textSizes = {
  "text-meta": 10,
  "text-label": 11,
  "text-body": 12,
  "text-panel": 14,
  "text-title": 19,
  "text-kpi": 22,
} as const;

export const weights = { "weight-regular": 400, "weight-medium": 500, "weight-strong": 600 } as const;

export const easings = {
  "ease-out": "cubic-bezier(.16, 1, .3, 1)",
  "ease-sheet": "cubic-bezier(.32, .72, 0, 1)",
} as const;

/** Milliseconds, by job. Every one is zeroed under prefers-reduced-motion. */
export const durations = {
  "dur-micro": 100,
  "dur-collapse": 150,
  "dur-exit": 160,
  "dur-enter": 220,
  "dur-theme": 200,
  "dur-draw": 550,
  "dur-spin": 900,
} as const;
