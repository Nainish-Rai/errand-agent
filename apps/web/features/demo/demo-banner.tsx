"use client";

import { FlaskConical } from "lucide-react";

import { focusRing } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { resetDemo } from "./demo-world";

// Always on screen in demo mode, so nobody mistakes the scripted replies for the agent. Toast's ink
// surface (--ink with --fg-inverse), so it reads the same in light and dark and never competes with the
// view's one lime action. Wide screens get the whole sentence in the bottom-left corner, where no view
// puts anything; narrow ones a short line at the top centre, between the header's controls.

const REPO_URL = "https://github.com/Nainish-Rai/errand-agent";

const link = cn(focusRing, "rounded-sm font-medium text-fg-inverse underline underline-offset-2");

function reset() {
  resetDemo();
  window.location.assign("/");
}

export function DemoBanner() {
  return (
    <aside
      aria-label="Demo mode"
      data-slot="demo-banner"
      className={cn(
        "fixed z-50 flex items-center gap-2 rounded-panel bg-ink px-3 py-2 text-xs leading-snug text-fg-inverse shadow-menu",
        "top-1.5 left-1/2 -translate-x-1/2 xl:top-auto xl:bottom-3 xl:left-3 xl:max-w-56 xl:translate-x-0 xl:items-start",
      )}
    >
      <FlaskConical aria-hidden className="size-3.5 shrink-0 xl:mt-0.5" />
      <div className="flex min-w-0 items-center gap-2 xl:flex-col xl:items-start xl:gap-1">
        <p className="m-0 whitespace-nowrap xl:hidden">Demo: scripted, no backend</p>
        <p className="m-0 hidden xl:block">
          Demo mode — scripted responses, no model or backend. Real agent:{" "}
          <a className={link} href={REPO_URL} target="_blank" rel="noreferrer">
            see the repo
          </a>
          .
        </p>
        <button type="button" className={cn(link, "cursor-pointer bg-transparent p-0 text-xs")} onClick={reset}>
          Reset demo
        </button>
      </div>
    </aside>
  );
}
