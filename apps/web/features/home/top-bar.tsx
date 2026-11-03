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
import { providerAlertHref } from "./home-lists";

// The bar at the top of home: the home switcher, search (a command menu, ⌘K), memory (the memory sheet),
// the theme toggle and the notification bell. The bell counts alerts that need the person.

type Summary = GetHomeSummaryResponse;

const glass = cn(
  focusRing,
  "inline-flex h-7 items-center gap-1.5 rounded-control border border-line bg-page px-2.5 text-xs text-fg hover:bg-surface-2",
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
      <DropdownMenuContent align="start" className="w-52 text-xs">
        <DropdownMenuLabel className="text-xs text-fg-3">Go to</DropdownMenuLabel>
        <DropdownMenuItem asChild className="text-xs">
          <Link href="/">
            <House /> Home
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="text-xs">
          <Link href="/chat">
            <MessageSquarePlus /> New chat
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="text-xs">
          <Link href="/design">
            <Palette /> Design system
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CommandMenu({ open, onOpenChange, summary, onNewErrand, onOpenMemory }: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly summary?: Summary;
  readonly onNewErrand: () => void;
  readonly onOpenMemory: () => void;
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
          <CommandItem
            onSelect={() => {
              onOpenChange(false);
              onOpenMemory();
            }}
          >
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
                {errandTitle(errand)} <span className="ml-auto text-xs text-fg-3">{stepLabel(errand.state)}</span>
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
            className="size-7 rounded-control border border-line bg-page"
            {...(count > 0 ? { badge: { value: count, tone: "alert" as const } } : {})}
          />
        }
      />
      <PopoverContent align="end" className="w-72 p-3 text-xs">
        <p className="m-0 mb-1 font-medium text-fg">Notifications</p>
        {needing.length === 0 ? (
          <p className="m-0 text-fg-3">Nothing needs you. Provider cancellations will show up here.</p>
        ) : (
          <ul className="m-0 grid list-none gap-1 p-0">
            {needing.map((alert) => (
              <li key={alert.kind === "provider_cancelled" ? alert.alertId : alert.errandId} className="text-fg-2">
                <Link
                  href={alert.kind === "provider_cancelled" ? providerAlertHref(alert) : `/chat/${encodeURIComponent(alert.sessionId)}`}
                  className={cn("block rounded-sm px-1 py-0.5 hover:bg-surface-2", focusRing)}
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

export function TopBar({ summary, onNewErrand, onOpenMemory }: { readonly summary?: Summary; readonly onNewErrand: () => void; readonly onOpenMemory: () => void }) {
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
    <nav aria-label="Home bar" className="mx-auto flex w-full max-w-[42rem] items-center justify-between gap-2 px-4 pt-3">
      <HomeSwitcher waiting={summary?.counts.waitingOnYou ?? 0} />
      <div className="flex items-center gap-1.5">
        <button type="button" className={glass} onClick={() => setSearching(true)} aria-keyshortcuts="Meta+K Control+K">
          <Search aria-hidden className="size-3.5" />
          Search
          <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
        </button>
        <button type="button" className={glass} onClick={onOpenMemory} aria-haspopup="dialog">
          <Brain aria-hidden className="size-3.5" />
          Memory
        </button>
        <ThemeToggle className="size-7 rounded-control border border-line bg-page" />
        <NotificationBell summary={summary} />
      </div>
      <CommandMenu open={searching} onOpenChange={setSearching} summary={summary} onNewErrand={onNewErrand} onOpenMemory={onOpenMemory} />
    </nav>
  );
}
