"use client";

import { useAuiState } from "@assistant-ui/react";
import { askFormMessage } from "@errand/client";
import type { AskField, ErrandView } from "@errand/contracts";
import { Chips, DatePicker, Slider } from "@openuidev/react-ui";
import { useState } from "react";

import { Skeleton } from "@/components/skeleton";
import { Button } from "@/components/ui/button";

import { useErrand, useGeneratedUiHost } from "./bound-data";

// The missing-details form: only the errand's missing fields (read live from the errand, so a
// field answered since is gone), as chips plus a date picker for "when", and an optional budget
// slider. Submitting sends one ordinary message as the person, e.g. "When: Tomorrow morning"; the
// agent reads it like anything typed.

const FIELD_LABELS: Readonly<Record<AskField, string>> = { service: "Service", area: "Area", timeWindow: "When" };
const SERVICE_CHOICES = ["Plumber", "Electrician", "AC servicing", "Carpenter", "Cleaner"];
const WHEN_CHOICES = ["Today", "Tomorrow morning", "This weekend", "This week"];
const DAY_PARTS = ["Morning", "Afternoon", "Evening", "Any time"];
const BUDGET = { min: 200, max: 3000, step: 100, start: 1000 } as const;

const dayFormat = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short" });

function choicesFor(field: AskField, errand: ErrandView | null): string[] {
  const replies = (errand?.question?.quickReplies ?? []).filter((reply) => reply.field === field).map((reply) => reply.text);
  if (replies.length > 0) return replies;
  if (field === "service") return SERVICE_CHOICES;
  if (field === "timeWindow") return WHEN_CHOICES;
  return [];
}

function WhenField({ choices, value, onChange }: { readonly choices: readonly string[]; readonly value: string; readonly onChange: (value: string) => void }) {
  const [date, setDate] = useState<Date>();
  const [part, setPart] = useState<string>();
  const [open, setOpen] = useState(false);
  const fromDate = (picked: Date | undefined, dayPart: string | undefined) => {
    if (picked === undefined) return;
    onChange(dayPart === undefined || dayPart === "Any time" ? dayFormat.format(picked) : `${dayFormat.format(picked)}, ${dayPart.toLowerCase()}`);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <Chips items={choices.map((choice) => ({ value: choice, label: choice }))} selected={[value]} type="single" onToggle={onChange} />
      <div className="flex flex-wrap items-center gap-1.5">
        <DatePicker
          mode="single"
          selectedSingleDate={date}
          setSelectedSingleDate={(picked) => {
            setDate(picked);
            fromDate(picked, part);
          }}
          isOpen={open}
          setIsOpen={setOpen}
        />
        {date !== undefined && (
          <Chips
            items={DAY_PARTS.map((dayPart) => ({ value: dayPart, label: dayPart }))}
            selected={part === undefined ? [] : [part]}
            type="single"
            onToggle={(dayPart) => {
              setPart(dayPart);
              fromDate(date, dayPart);
            }}
          />
        )}
      </div>
    </div>
  );
}

function Field({
  field,
  errand,
  value,
  onChange,
}: {
  readonly field: AskField;
  readonly errand: ErrandView | null;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const choices = choicesFor(field, errand);
  return (
    <div role="group" aria-label={FIELD_LABELS[field]} className="flex flex-col gap-1.5">
      <span className="text-label text-fg-meta">{FIELD_LABELS[field]}</span>
      {field === "timeWindow" ? (
        <WhenField choices={choices} value={value} onChange={onChange} />
      ) : (
        <>
          {choices.length > 0 && <Chips items={choices.map((choice) => ({ value: choice, label: choice }))} selected={[value]} type="single" onToggle={onChange} />}
          {field === "area" && (
            <input
              aria-label="Another area"
              placeholder="Another area"
              value={choices.includes(value) ? "" : value}
              onChange={(event) => onChange(event.target.value)}
              className="h-8 rounded-md border border-edge bg-surface-canvas px-2 text-label text-fg-emph outline-none placeholder:text-fg-meta focus-visible:border-interactive"
            />
          )}
        </>
      )}
    </div>
  );
}

export function AskForm({ fields, title }: { readonly fields: readonly AskField[]; readonly title?: string }) {
  const { send } = useGeneratedUiHost();
  const running = useAuiState((state) => state.thread.isRunning);
  const errand = useErrand();
  const [values, setValues] = useState<Partial<Record<AskField, string>>>({});
  const [budget, setBudget] = useState<number>();
  const [sent, setSent] = useState(false);

  if (errand.status === "loading") {
    return (
      <div aria-busy className="my-3 rounded-lg border border-edge bg-surface-card p-3">
        <Skeleton className="h-16" />
      </div>
    );
  }
  const current = errand.status === "ready" ? errand.data : null;
  // Only what is still missing: a field answered since the form was drawn drops out.
  const asking = fields.filter((field) => current === null || current.missing.includes(field));
  if (asking.length === 0) return null;
  const complete = asking.every((field) => (values[field] ?? "").trim() !== "");

  return (
    <form
      aria-label={title ?? "Missing details"}
      data-testid="ask-form"
      className="my-3 flex flex-col gap-3 rounded-lg border border-edge bg-surface-card p-3"
      onSubmit={(event) => {
        event.preventDefault();
        setSent(true);
        void send(askFormMessage({ values: Object.fromEntries(asking.map((field) => [field, values[field] ?? ""])), ...(budget === undefined ? {} : { budgetInr: budget }) }));
      }}
    >
      <p className="m-0 text-panel font-medium text-fg-emph">{title ?? "A few details"}</p>
      {asking.map((field) => (
        <Field key={field} field={field} errand={current} value={values[field] ?? ""} onChange={(value) => setValues((before) => ({ ...before, [field]: value }))} />
      ))}
      {current?.budgetInr === null && (
        <div role="group" aria-label="Budget (optional)" className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-label text-fg-meta">
            <input type="checkbox" checked={budget !== undefined} onChange={(event) => setBudget(event.target.checked ? BUDGET.start : undefined)} />
            Set a budget (optional)
          </label>
          {budget !== undefined && (
            <Slider
              variant="continuous"
              min={BUDGET.min}
              max={BUDGET.max}
              step={BUDGET.step}
              value={[budget]}
              onValueChange={(next: number[]) => setBudget(next[0] ?? budget)}
              aria-label="Budget"
              rightContent={<span className="font-mono text-label tabular-nums text-fg-emph">up to ₹{budget.toLocaleString("en-IN")}</span>}
            />
          )}
        </div>
      )}
      <div>
        <Button type="submit" size="sm" variant="primary" disabled={!complete || running || sent}>
          {sent ? "Sent" : "Send"}
        </Button>
      </div>
    </form>
  );
}
