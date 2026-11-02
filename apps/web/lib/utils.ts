import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The token type scale (text-meta … text-kpi) are font sizes. Without this, tailwind-merge reads
// `text-label` as a colour and drops a `text-primary-foreground` next to it.
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ["meta", "label", "body", "panel", "title", "kpi"] } },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
