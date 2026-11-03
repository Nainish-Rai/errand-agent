"use client";

import { ApiRequestError } from "@errand/client";
import type { DraftErrandRequest, GetHomeSummaryResponse } from "@errand/contracts";
import { ArrowUp, Clock, IndianRupee, MapPin } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";

import { FilterChip } from "@/components/chip";
import { Presence, Reveal } from "@/components/layout-motion";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { hourLabel } from "./errand-words";
import { startErrand } from "./start-errand";

// The home composer, v3's ChatInput: the errand in the person's words, the chips for area, budget, time
// of day and model under it, and Send, the view's one lime action, lit only once there is text. Sending
// saves the chips as the new chat's errand before the first model turn, so the agent never asks for
// them; the chips start from the person's memory. A pressed suggestion or service tile sends as written.

type Summary = GetHomeSummaryResponse;
type When = NonNullable<DraftErrandRequest["when"]>;

interface Choice<T> {
  readonly key: string;
  readonly value: T;
  /** On the chip. */
  readonly short: string;
  /** In the menu. */
  readonly long: string;
}

const NOT_SET = "none";

const BUDGETS = [500, 800, 1_000, 1_500, 2_000, 3_000];

const TIMES: readonly Choice<When>[] = [
  { key: "week", value: { earliestHour: null, latestHour: null }, short: "This week", long: "This week, any time" },
  { key: "mornings", value: { earliestHour: 8, latestHour: 12 }, short: "Mornings", long: "Mornings this week (08:00–12:00)" },
  { key: "afternoons", value: { earliestHour: 12, latestHour: 17 }, short: "Afternoons", long: "Afternoons this week (12:00–17:00)" },
  { key: "evenings", value: { earliestHour: 17, latestHour: 21 }, short: "Evenings", long: "Evenings this week (17:00–21:00)" },
];

function rupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

function budgetChoices(remembered: number | null): Choice<number>[] {
  const amounts = remembered === null || BUDGETS.includes(remembered) ? BUDGETS : [...BUDGETS, remembered].sort((a, b) => a - b);
  return amounts.map((amount) => ({ key: String(amount), value: amount, short: `Under ${rupees(amount)}`, long: `Under ${rupees(amount)}` }));
}

function timeChoices(earliestHour: number | null): Choice<When>[] {
  if (earliestHour === null) return [...TIMES];
  const remembered: Choice<When> = {
    key: `from-${earliestHour}`,
    value: { earliestHour, latestHour: null },
    short: `From ${hourLabel(earliestHour)}`,
    long: `This week, from ${hourLabel(earliestHour)} (your usual)`,
  };
  return [remembered, ...TIMES];
}

interface ChipMenuProps<T> {
  readonly label: string;
  readonly icon: ReactNode;
  readonly choices: readonly Choice<T>[];
  readonly chosen: string;
  readonly onChoose: (key: string) => void;
  /** What "not set" means for this chip, in the menu. */
  readonly unset: { readonly short: string; readonly long: string };
  readonly remembered?: boolean;
}

/** A filter chip whose menu picks one value, or none. */
function ChipMenu<T>({ label, icon, choices, chosen, onChoose, unset, remembered = false }: ChipMenuProps<T>) {
  const current = choices.find((choice) => choice.key === chosen);
  const shown = current?.short ?? unset.short;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <FilterChip
          icon={icon}
          value={shown}
          selected={current !== undefined}
          aria-label={`${label}: ${current === undefined ? "not set" : current.short}${remembered && current !== undefined ? " (from memory)" : ""}`}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 text-sm">
        <DropdownMenuLabel className="text-xs text-fg-3">{label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={chosen} onValueChange={onChoose}>
          <DropdownMenuRadioItem value={NOT_SET}>{unset.long}</DropdownMenuRadioItem>
          {choices.map((choice) => (
            <DropdownMenuRadioItem key={choice.key} value={choice.key}>
              {choice.long}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModelChip({ model }: { readonly model: Summary["composer"]["model"] }) {
  const name = model.provider === "minimax" ? model.modelId : "Scripted (offline)";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <FilterChip icon={<span className="block size-2 rounded-full bg-success" />} value={name} aria-label={`Model: ${name}`} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 text-sm">
        <DropdownMenuLabel className="text-xs text-fg-3">Model (calls tools)</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={model.modelId}>
          <DropdownMenuRadioItem value={model.modelId}>{name}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <p className="m-0 px-2 py-1.5 text-xs text-fg-3">The backend picks the model (ERRAND_MODELS). Only models that can call tools are offered.</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ChipState {
  readonly area: string;
  readonly budget: string;
  readonly time: string;
}

function chipsFrom(composer: Summary["composer"]): ChipState {
  return {
    area: composer.area ?? NOT_SET,
    budget: composer.budgetInr === null ? NOT_SET : String(composer.budgetInr),
    time: composer.earliestHour === null ? "week" : `from-${composer.earliestHour}`,
  };
}

function draftOf(chips: ChipState, times: readonly Choice<When>[]): DraftErrandRequest {
  return {
    area: chips.area === NOT_SET ? null : chips.area,
    budgetInr: chips.budget === NOT_SET ? null : Number(chips.budget),
    when: times.find((choice) => choice.key === chips.time)?.value ?? null,
  };
}

export interface ErrandComposer {
  readonly summary?: Summary;
  readonly prompt: string;
  readonly setPrompt: (text: string) => void;
  readonly chips?: ChipState;
  readonly setChips: (chips: ChipState) => void;
  readonly sending: boolean;
  readonly problem?: string;
  /** Sends `text` (or what is typed) with the chips; until the chips load it only fills the field. */
  readonly send: (text?: string) => void;
  readonly input: RefObject<HTMLTextAreaElement | null>;
}

/** The composer's state, shared with home so a suggestion or a tile can send, and the lists can step aside. */
export function useErrandComposer(summary: Summary | undefined): ErrandComposer {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [chips, setChips] = useState<ChipState>();
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string>();
  const input = useRef<HTMLTextAreaElement>(null);

  // The chips start from memory once the first summary arrives; after that they are the person's.
  useEffect(() => {
    if (summary !== undefined && chips === undefined) setChips(chipsFrom(summary.composer));
  }, [summary, chips]);

  const send = (text?: string) => {
    const words = (text ?? prompt).trim();
    if (text !== undefined) setPrompt(text);
    if (chips === undefined || words === "" || sending) {
      input.current?.focus();
      return;
    }
    setSending(true);
    setProblem(undefined);
    const times = timeChoices(summary?.composer.earliestHour ?? null);
    startErrand({ text: words, draft: draftOf(chips, times) }).then(
      (sessionId) => router.push(`/chat/${encodeURIComponent(sessionId)}`),
      (error: unknown) => {
        setProblem(error instanceof ApiRequestError ? error.message : "Couldn't start the errand. Is the backend running?");
        setSending(false);
      },
    );
  };

  return { summary, prompt, setPrompt, chips, setChips, sending, problem, send, input };
}

export function Composer({ composer }: { readonly composer: ErrandComposer }) {
  const { summary, prompt, setPrompt, chips, setChips, sending, problem, send, input } = composer;
  const memory = summary?.composer;
  const times = timeChoices(memory?.earliestHour ?? null);
  const budgets = budgetChoices(memory?.budgetInr ?? null);
  const areas: Choice<string>[] = (memory?.areas ?? []).map((area) => ({ key: area, value: area, short: area, long: area }));
  const ready = chips !== undefined && prompt.trim().length > 0 && !sending;

  function submit(event: Pick<FormEvent, "preventDefault">) {
    event.preventDefault();
    if (ready) send();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
  }

  return (
    <form
      onSubmit={submit}
      aria-label="New errand"
      className="grid gap-1 rounded-sheet border border-line-strong bg-field p-1.5 transition-colors duration-(--dur-instant) ease-out focus-within:border-accent-line"
    >
      <textarea
        ref={input}
        aria-label="Describe your errand"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={onKeyDown}
        rows={2}
        placeholder="Book a plumber for Thursday morning"
        className="block min-h-14 w-full resize-none bg-transparent px-2.5 pt-1.5 text-base text-fg outline-none placeholder:text-fg-3"
        // The one form field home renders on the server. Writing and password extensions (Grammarly,
        // LanguageTool …) add attributes to it before React hydrates, which React reports as a hydration
        // mismatch on this element. Their attributes are theirs to keep; React patches nothing here.
        suppressHydrationWarning
      />
      <div className="flex flex-wrap items-center gap-1.5 px-1">
        <Presence wait>
          {chips === undefined ? (
            <Reveal key="loading" as="p" className="m-0 text-xs text-fg-3">
              Loading your preferences…
            </Reveal>
          ) : (
            <Reveal key="chips" className="flex flex-wrap items-center gap-1.5">
              <ChipMenu
                label="Area"
                icon={<MapPin className="size-3.5" />}
                choices={areas}
                chosen={chips.area}
                onChoose={(area) => setChips({ ...chips, area })}
                unset={{ short: "Area", long: "Not set (the agent will ask)" }}
                remembered={memory?.area !== null && chips.area === memory?.area}
              />
              <ChipMenu
                label="Budget"
                icon={<IndianRupee className="size-3.5" />}
                choices={budgets}
                chosen={chips.budget}
                onChoose={(budget) => setChips({ ...chips, budget })}
                unset={{ short: "Any budget", long: "Any budget" }}
                remembered={memory?.budgetInr !== null && chips.budget === String(memory?.budgetInr)}
              />
              <ChipMenu
                label="Time"
                icon={<Clock className="size-3.5" />}
                choices={times}
                chosen={chips.time}
                onChoose={(time) => setChips({ ...chips, time })}
                unset={{ short: "When?", long: "Not set (the agent will ask)" }}
                remembered={memory?.earliestHour !== null && chips.time === `from-${memory?.earliestHour}`}
              />
              {memory !== undefined && <ModelChip model={memory.model} />}
            </Reveal>
          )}
        </Presence>
        <Button type="submit" aria-label="Start errand" size="icon" variant={ready || sending ? "primary" : "secondary"} disabled={!ready} loading={sending} className="ml-auto">
          {!sending && <ArrowUp />}
        </Button>
      </div>
      <Presence>
        {problem !== undefined && (
          <Reveal key="problem" as="p" role="alert" className="m-0 px-2.5 pb-1 text-sm text-danger-text">
            {problem}
          </Reveal>
        )}
      </Presence>
    </form>
  );
}
