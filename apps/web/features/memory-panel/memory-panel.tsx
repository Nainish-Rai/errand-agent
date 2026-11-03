"use client";

import { ApiClient } from "@errand/client";
import type { ListMemoryResponse, MemoryFactView, MemoryKey, TombstoneView } from "@errand/contracts";
import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ForgottenFactRow, MemoryFactRow, type MemoryFact } from "@/features/trust";

// What the agent remembers about the person, beside the chat. Every action goes to the app API
// (Correct supersedes, Forget writes a tombstone, Confirm activates a guess); the panel shows what
// the backend then serves, and refetches whenever the chat sees new activity, so a fact changed in
// chat shows up here too.

const dayFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

function day(isoTime: string): string {
  return dayFormat.format(new Date(isoTime));
}

function statementOf(fact: MemoryFactView): string {
  return `${fact.label} · ${fact.display}`;
}

function sourceOf(fact: MemoryFactView): string {
  if (fact.status === "pending_confirmation") return `noticed ${day(fact.validFrom)} · not used until you confirm`;
  if (fact.confirmedAt !== null) return `inferred · you confirmed ${day(fact.confirmedAt)}`;
  if (fact.evidence.kind === "user_action") return `you set it · ${day(fact.validFrom)}`;
  return `you said · ${day(fact.validFrom)}`;
}

function rowFact(fact: MemoryFactView): MemoryFact {
  return { statement: statementOf(fact), origin: fact.source, source: sourceOf(fact) };
}

/** The value a forgotten key last had, for its tombstone line. */
function tombstoneStatement(tombstone: TombstoneView, facts: readonly MemoryFactView[]): string {
  const last = facts.findLast((fact) => fact.key === tombstone.key && fact.status === "forgotten");
  return last === undefined ? tombstone.label : statementOf(last);
}

function useMemoryFacts(api: ApiClient, activity: number) {
  const [memory, setMemory] = useState<ListMemoryResponse>();
  const [error, setError] = useState<string>();
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const request = (latest.current += 1);
    try {
      const next = await api.listMemory();
      if (request === latest.current) {
        setMemory(next);
        setError(undefined);
      }
    } catch (failure) {
      if (request === latest.current) setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh, activity]);

  return { memory, error, refresh };
}

function CorrectionForm({
  fact,
  busy,
  onSave,
  onCancel,
}: {
  readonly fact: MemoryFactView;
  readonly busy: boolean;
  readonly onSave: (value: string) => void;
  readonly onCancel: () => void;
}) {
  const [value, setValue] = useState(fact.value);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim() !== "") onSave(value.trim());
  };
  return (
    <form onSubmit={submit} className="mt-1.5 flex items-center gap-2" aria-label={`Correct ${fact.label.toLowerCase()}`}>
      <Input
        aria-label={`New ${fact.label.toLowerCase()}`}
        autoFocus
        className="h-8"
        maxLength={80}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <Button size="sm" type="submit" loading={busy} disabled={value.trim() === ""}>
        Save
      </Button>
      <Button size="sm" type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

export function MemoryPanel({
  backendUrl,
  activity,
  onClose,
}: {
  readonly backendUrl: string;
  /** Changes whenever the chat sees new session events. */
  readonly activity: number;
  readonly onClose: () => void;
}) {
  const api = useMemo(() => new ApiClient({ baseUrl: backendUrl }), [backendUrl]);
  const { memory, error, refresh } = useMemoryFacts(api, activity);
  const [editing, setEditing] = useState<MemoryKey>();
  const [busy, setBusy] = useState<string>();
  const [actionError, setActionError] = useState<string>();

  const act = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setActionError(undefined);
    try {
      await action();
      setEditing(undefined);
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(undefined);
      await refresh();
    }
  };

  const current = (memory?.facts ?? []).filter((fact) => fact.status === "active" || fact.status === "pending_confirmation");
  const replaced = (memory?.facts ?? []).filter((fact) => fact.status === "superseded");
  const tombstones = memory?.tombstones ?? [];
  // One tombstone line per key: the latest, and only while nothing new holds the key.
  const forgotten = tombstones.filter(
    (tombstone, index) =>
      tombstones.findLastIndex((other) => other.key === tombstone.key) === index && !current.some((fact) => fact.key === tombstone.key),
  );

  return (
    <aside
      aria-label="Memory"
      aria-busy={memory === undefined || undefined}
      className="fixed inset-0 z-30 flex h-dvh w-full flex-col gap-3 overflow-y-auto border-l border-edge bg-surface-canvas p-3 text-body lg:static lg:z-auto lg:w-[24rem] lg:shrink-0"
    >
      <header className="flex items-center justify-between gap-2">
        <div>
          <h2 className="m-0 text-panel font-semibold text-fg-emph">Memory</h2>
          <p className="m-0 text-label text-fg-meta">What the agent remembers about you. Guesses are dashed and never used until you confirm them.</p>
        </div>
        <Button aria-label="Close memory" size="icon" variant="ghost" onClick={onClose}>
          <X />
        </Button>
      </header>

      {(error ?? actionError) !== undefined && (
        <p className="m-0 rounded-md bg-err-tint px-3 py-2 text-label text-fg-emph" role="alert">
          {actionError ?? `Can't read memory: ${error}`}
        </p>
      )}

      {memory === undefined ? (
        <div className="grid gap-2">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      ) : current.length === 0 && forgotten.length === 0 ? (
        <EmptyState message="Nothing remembered yet. Tell the agent your usual area or budget and ask it to remember." />
      ) : null}

      {current.length > 0 && (
        <ul aria-label="Remembered facts" className="m-0 grid list-none gap-1.5 p-0">
          {current.map((fact) => (
            <li key={fact.id} aria-label={statementOf(fact)}>
              <MemoryFactRow
                fact={rowFact(fact)}
                onCorrect={() => setEditing(fact.key)}
                onForget={() => void act(`forget:${fact.key}`, () => api.forgetMemoryFact(fact.key))}
                onConfirm={
                  fact.status === "pending_confirmation" ? () => void act(`confirm:${fact.id}`, () => api.confirmMemoryFact(fact.id)) : undefined
                }
              />
              {editing === fact.key && (
                <CorrectionForm
                  fact={fact}
                  busy={busy === `correct:${fact.key}`}
                  onCancel={() => setEditing(undefined)}
                  onSave={(value) => void act(`correct:${fact.key}`, () => api.correctMemoryFact(fact.key, { value }))}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {forgotten.length > 0 && (
        <section aria-label="Forgotten" className="grid gap-1.5">
          <h3 className="m-0 text-label font-normal text-fg-meta">Forgotten</h3>
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {forgotten.map((tombstone) => (
              <li key={tombstone.key} aria-label={`Forgotten: ${tombstone.label}`}>
                <ForgottenFactRow statement={tombstoneStatement(tombstone, memory?.facts ?? [])} forgottenOn={day(tombstone.forgottenAt)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {replaced.length > 0 && (
        <section aria-label="Replaced" className="grid gap-1">
          <h3 className="m-0 text-label font-normal text-fg-meta">Replaced</h3>
          <ul className="m-0 grid list-none gap-1 p-0">
            {replaced.map((fact) => (
              <li key={fact.id} aria-label={`Replaced: ${statementOf(fact)}`} className="font-mono text-meta text-fg-meta">
                {statementOf(fact)} · until {fact.validTo === null ? "now" : day(fact.validTo)} · kept, never used
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
