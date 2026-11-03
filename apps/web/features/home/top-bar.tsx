"use client";

import type { GetHomeSummaryResponse } from "@errand/contracts";
import { Bell, Brain, House, MessageSquarePlus, Palette, Search, SunMoon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/agents/ui/popover";
import { IconButton } from "@/components/icon-button";
import { Kbd } from "@/components/kbd";
import { useTheme } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { focusRing } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { errandTitle, stepLabel } from "./errand-words";
import { providerAlertHref } from "./widgets";

// The bar over the hero: the home switcher, search (a command menu, ⌘K), the theme toggle and the
// notification bell. The bell counts alerts that need the person; ticket 14 adds the live feed.

type Summary = GetHomeSummaryResponse;

const glass = cn(
  focusRing,
  "inline-flex h-7 items-center gap-1.5 rounded-md border border-edge-glass bg-surface-glass px-2 text-label text-fg-emph backdrop-blur-sm hover:bg-surface-raised",
);

function HomeSwitcher({ waiting }: { readonly waiting: number }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={glass} aria-label={`Home, ${waiting} waiting on you`}>
        <House aria-hidden className="size-3.5" />
        <b className="font-semibold">Home</b>
        {waiting > 0 && (
          <Badge aria-hidden variant="count">
            {waiting}
          </Badge>
        )}
        <span aria-hidden>⌄</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52 text-label">
        <DropdownMenuLabel className="text-meta text-fg-meta">Go to</DropdownMenuLabel>
        <DropdownMenuItem asChild className="text-label">
          <Link href="/">
            <House /> Home
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="text-label">
          <Link href="/chat">
            <MessageSquarePlus /> New chat
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="text-label">
          <Link href="/design">
            <Palette /> Design system
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CommandMenu({ open, onOpenChange, summary, onNewErrand }: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly summary?: Summary;
  readonly onNewErrand: () => void;
}) {
  const router = useRouter();
  const { toggleTheme } = useTheme();
  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Jump to an errand, a chat or a setting.">
      <CommandInput placeholder="Search errands and actions…" />
      <CommandList>
        <CommandEmpty>Nothing matches.</CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem
            onSelect={() => {
              onOpenChange(false);
              onNewErrand();
            }}
          >
            <MessageSquarePlus /> New errand
          </CommandItem>
          <CommandItem onSelect={() => go("/chat?rail=memory")}>
            <Brain /> Open memory
          </CommandItem>
          <CommandItem
            onSelect={() => {
              onOpenChange(false);
              toggleTheme();
            }}
          >
            <SunMoon /> Switch theme
          </CommandItem>
          <CommandItem onSelect={() => go("/design")}>
            <Palette /> Design system
          </CommandItem>
        </CommandGroup>
        {(summary?.working.length ?? 0) > 0 && (
          <CommandGroup heading="Running errands">
            {summary?.working.map((errand) => (
              <CommandItem key={errand.errandId} value={`${errandTitle(errand)} ${errand.sessionId}`} onSelect={() => go(`/chat/${encodeURIComponent(errand.sessionId)}`)}>
                {errandTitle(errand)} <span className="ml-auto text-meta text-fg-meta">{stepLabel(errand.state)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}

function NotificationBell({ summary }: { readonly summary?: Summary }) {
  const count = summary?.counts.alerts ?? 0;
  const needing = (summary?.alerts ?? []).filter(
    (alert) => alert.kind === "errand_failed" || (alert.kind === "provider_cancelled" && !alert.rebooked),
  );
  return (
    <Popover>
      <PopoverTrigger
        render={
          <IconButton
            label="Notifications"
            icon={<Bell />}
            variant="ghost"
            className="size-7 rounded-md border border-edge-glass bg-surface-glass backdrop-blur-sm"
            {...(count > 0 ? { badge: { value: count, tone: "alert" as const } } : {})}
          />
        }
      />
      <PopoverContent align="end" className="w-72 p-3 text-label">
        <p className="m-0 mb-1 font-medium text-fg-emph">Notifications</p>
        {needing.length === 0 ? (
          <p className="m-0 text-fg-meta">Nothing needs you. Provider cancellations will show up here.</p>
        ) : (
          <ul className="m-0 grid list-none gap-1 p-0">
            {needing.map((alert) => (
              <li key={alert.kind === "provider_cancelled" ? alert.alertId : alert.errandId} className="text-fg-body">
                <Link
                  href={alert.kind === "provider_cancelled" ? providerAlertHref(alert) : `/chat/${encodeURIComponent(alert.sessionId)}`}
                  className={cn("block rounded-sm px-1 py-0.5 hover:bg-surface-raised", focusRing)}
                >
                  {alert.kind === "provider_cancelled"
                    ? `${alert.providerName} cancelled a booking`
                    : alert.service === null
                      ? "An errand stopped"
                      : `${errandTitle(alert)} stopped`}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function TopBar({ summary, onNewErrand }: { readonly summary?: Summary; readonly onNewErrand: () => void }) {
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setSearching((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <nav aria-label="Home bar" className="absolute inset-x-3 top-2.5 z-20 flex items-center justify-between gap-2">
      <HomeSwitcher waiting={summary?.counts.waitingOnYou ?? 0} />
      <div className="flex items-center gap-1.5">
        <button type="button" className={glass} onClick={() => setSearching(true)} aria-keyshortcuts="Meta+K Control+K">
          <Search aria-hidden className="size-3.5" />
          Search
          <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
        </button>
        <ThemeToggle className="size-7 rounded-md border border-edge-glass bg-surface-glass backdrop-blur-sm" />
        <NotificationBell summary={summary} />
      </div>
      <CommandMenu open={searching} onOpenChange={setSearching} summary={summary} onNewErrand={onNewErrand} />
    </nav>
  );
}
