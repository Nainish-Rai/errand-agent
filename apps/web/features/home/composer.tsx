"use client";

import { ApiRequestError } from "@errand/client";
import type { DraftErrandRequest, GetHomeSummaryResponse } from "@errand/contracts";
import { ArrowUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";

import { FilterChip } from "@/components/chip";
import { EmptyState } from "@/components/empty-state";
import { TabPanel, UnderlineTabs } from "@/components/tabs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ListRow } from "@/components/widget";

import { errandDetails, errandTitle, hourLabel, stepLabel } from "./errand-words";
import { ErrandMark } from "./errand-mark";
import { startErrand } from "./start-errand";

// The home composer: New errand (text plus chips for area, budget, time of day and model) and
// Running N (errands in progress). Sending saves the chips as the new chat's errand before the
// first model turn, so the agent never asks for them; the chips start from the person's memory.

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
      <DropdownMenuContent align="start" className="max-h-72 text-xs">
        <DropdownMenuLabel className="text-xs text-fg-3">{label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={chosen} onValueChange={onChoose}>
          <DropdownMenuRadioItem value={NOT_SET} className="text-xs">
            {unset.long}
          </DropdownMenuRadioItem>
          {choices.map((choice) => (
            <DropdownMenuRadioItem key={choice.key} value={choice.key} className="text-xs">
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
        <FilterChip icon={<span className="text-success-text">●</span>} value={name} aria-label={`Model: ${name}`} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 text-xs">
        <DropdownMenuLabel className="text-xs text-fg-3">Model (calls tools)</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={model.modelId}>
          <DropdownMenuRadioItem value={model.modelId} className="text-xs">
            {name}
          </DropdownMenuRadioItem>
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

function RunningList({ working }: { readonly working: Summary["working"] }) {
  if (working.length === 0) return <EmptyState message="Nothing is running. Start an errand on the New errand tab." className="m-2" />;
  return (
    <ul aria-label="Running errands" className="m-0 list-none px-3 py-1">
      {working.map((errand) => (
        <li key={errand.errandId}>
          <Link href={`/chat/${encodeURIComponent(errand.sessionId)}`} className="block rounded-md hover:bg-surface-2">
            <ListRow
              lead={<ErrandMark waitingOn={errand.waitingOn} />}
              title={errandTitle(errand)}
              meta={`${stepLabel(errand.state)} · ${errandDetails(errand)}`}
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function Composer({ summary, prompt, onPromptChange }: { readonly summary?: Summary; readonly prompt: string; readonly onPromptChange: (text: string) => void }) {
  const router = useRouter();
  const [tab, setTab] = useState<"new" | "running">("new");
  const [chips, setChips] = useState<ChipState>();
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string>();
  const input = useRef<HTMLTextAreaElement>(null);

  // The chips start from memory once the first summary arrives; after that they are the person's.
  useEffect(() => {
    if (summary !== undefined && chips === undefined) setChips(chipsFrom(summary.composer));
  }, [summary, chips]);

  const composer = summary?.composer;
  const times = timeChoices(composer?.earliestHour ?? null);
  const budgets = budgetChoices(composer?.budgetInr ?? null);
  const areas: Choice<string>[] = (composer?.areas ?? []).map((area) => ({ key: area, value: area, short: area, long: area }));
  const ready = chips !== undefined && prompt.trim().length > 0 && !sending;

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!ready || chips === undefined) return;
    setSending(true);
    setProblem(undefined);
    try {
      const sessionId = await startErrand({ text: prompt.trim(), draft: draftOf(chips, times) });
      router.push(`/chat/${encodeURIComponent(sessionId)}`);
    } catch (error) {
      setProblem(error instanceof ApiRequestError ? error.message : "Couldn't start the errand. Is the backend running?");
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) void send(event);
  }

  const running = summary?.counts.running ?? 0;
  return (
    <UnderlineTabs
      label="Composer"
      value={tab}
      onValueChange={setTab}
      items={[
        { value: "new", label: "New errand" },
        { value: "running", label: "Running", count: running },
      ]}
      className="relative z-10 mx-auto -mt-1.5 w-[min(34rem,calc(100%-1.5rem))] rounded-panel border border-line bg-raised pt-2 shadow-card [&>[role=tablist]]:border-b-0 [&>[role=tablist]]:px-3"
    >
      <TabPanel value="new" className="outline-none">
        <form onSubmit={(event) => void send(event)}>
          <textarea
            ref={input}
            aria-label="Describe your errand"
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder="Fix a leaking tap, service the AC, book the same electrician…"
            className="m-2 block h-12 w-[calc(100%-1rem)] resize-none rounded-field border border-line-strong bg-field p-2.5 text-sm text-fg outline-none placeholder:text-fg-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2">
            {chips === undefined ? (
              <span className="text-xs text-fg-3">Loading your preferences…</span>
            ) : (
              <>
                <ChipMenu
                  label="Area"
                  icon="📍"
                  choices={areas}
                  chosen={chips.area}
                  onChoose={(area) => setChips({ ...chips, area })}
                  unset={{ short: "Area", long: "Not set (the agent will ask)" }}
                  remembered={composer?.area !== null && chips.area === composer?.area}
                />
                <ChipMenu
                  label="Budget"
                  icon="₹"
                  choices={budgets}
                  chosen={chips.budget}
                  onChoose={(budget) => setChips({ ...chips, budget })}
                  unset={{ short: "Any budget", long: "Any budget" }}
                  remembered={composer?.budgetInr !== null && chips.budget === String(composer?.budgetInr)}
                />
                <ChipMenu
                  label="Time"
                  icon="🕘"
                  choices={times}
                  chosen={chips.time}
                  onChoose={(time) => setChips({ ...chips, time })}
                  unset={{ short: "When?", long: "Not set (the agent will ask)" }}
                  remembered={composer?.earliestHour !== null && chips.time === `from-${composer?.earliestHour}`}
                />
                {composer !== undefined && <ModelChip model={composer.model} />}
              </>
            )}
            <Button
              type="submit"
              aria-label="Start errand"
              size="icon-xs"
              variant="primary"
              disabled={!ready}
              loading={sending}
              className="ml-auto"
            >
              <ArrowUp />
            </Button>
          </div>
          {problem !== undefined && (
            <p role="alert" className="m-0 px-3 pb-2 text-xs text-danger-text">
              {problem}
            </p>
          )}
        </form>
      </TabPanel>
      <TabPanel value="running" className="outline-none">
        <RunningList working={summary?.working ?? []} />
      </TabPanel>
    </UnderlineTabs>
  );
}
