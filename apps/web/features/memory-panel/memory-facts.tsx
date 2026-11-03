"use client";

import type { ApiClient } from "@errand/client";
import type { ListMemoryResponse, MemoryFactView, MemoryKey, TombstoneView } from "@errand/contracts";
import { motion } from "motion/react";
import { Ellipsis, PencilLine, Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type SyntheticEvent } from "react";

import { CrossFade, Presence, Reveal, useLimeTiming } from "@/components/layout-motion";
import { Skeleton } from "@/components/skeleton";
import { Toast } from "@/components/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// What Errand keeps about the person, as v3's Memory section draws it, for both the memory sheet and the
// chat's memory panel. Each fact is a list row with a row menu (Correct, Forget). A guess the person has
// not confirmed sits in the dashed inferred edge with Confirm and Not right, and is never drawn like a
// fact. Every action goes to the app API (Correct supersedes, Forget writes a tombstone, Confirm
// activates a guess) and the list then shows what the backend serves. A forgotten fact's row collapses
// and its tombstone line arrives; a toast confirms what the person just did.

const dayFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

function day(isoTime: string): string {
  return dayFormat.format(new Date(isoTime));
}

function statementOf(fact: MemoryFactView): string {
  return `${fact.label} · ${fact.display}`;
}

function isGuess(fact: MemoryFactView): boolean {
  return fact.status === "pending_confirmation";
}

function sourceOf(fact: MemoryFactView): string {
  if (isGuess(fact)) return `Noticed ${day(fact.validFrom)} · not used until you confirm it`;
  if (fact.confirmedAt !== null) return `Inferred · you confirmed it ${day(fact.confirmedAt)}`;
  if (fact.supersedes !== null) return `You corrected it · ${day(fact.validFrom)}`;
  if (fact.evidence.kind === "user_action") return `You set it · ${day(fact.validFrom)}`;
  return `You said it · ${day(fact.validFrom)}`;
}

/** The value a forgotten key last had, for its tombstone line. */
function tombstoneStatement(tombstone: TombstoneView, facts: readonly MemoryFactView[]): string {
  const last = facts.findLast((fact) => fact.key === tombstone.key && fact.status === "forgotten");
  return last === undefined ? tombstone.label : statementOf(last);
}

// Every open memory view refetches when any of them changes a fact, so the sheet and the panel never
// disagree.
const memoryChanged = new Set<() => void>();

function announceMemoryChange() {
  for (const refresh of memoryChanged) refresh();
}

export function useMemoryFacts(api: ApiClient, activity: number) {
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

  useEffect(() => {
    const onChange = () => void refresh();
    memoryChanged.add(onChange);
    return () => {
      memoryChanged.delete(onChange);
    };
  }, [refresh]);

  return { memory, error, refresh };
}

const TOAST_MS = 5_000;

/** One toast at a time, past tense, never an error. It rises 8px in and fades out, and pauses while hovered. */
function useToast() {
  const [toast, setToast] = useState<{ readonly id: number; readonly text: string }>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dismissLater = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(undefined), TOAST_MS);
  }, []);
  const show = useCallback(
    (text: string) => {
      setToast((current) => ({ id: (current?.id ?? 0) + 1, text }));
      dismissLater();
    },
    [dismissLater],
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  return { toast, show, hold: () => clearTimeout(timer.current), release: dismissLater };
}

function ToastRegion({ toast, onHold, onRelease }: { readonly toast?: { readonly id: number; readonly text: string }; readonly onHold: () => void; readonly onRelease: () => void }) {
  const timing = useLimeTiming();
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-(--z-toast) mx-auto max-w-[24rem]">
      <Presence>
        {toast !== undefined && (
          <motion.div
            key={toast.id}
            className="pointer-events-auto"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: timing.arrive }}
            exit={{ opacity: 0, transition: timing.leave }}
            onPointerEnter={onHold}
            onPointerLeave={onRelease}
          >
            <Toast tone="ok" className="min-h-10 text-sm">
              {toast.text}
            </Toast>
          </motion.div>
        )}
      </Presence>
    </div>
  );
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
  const inputId = useId();
  const name = fact.label.toLowerCase();
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (value.trim() !== "") onSave(value.trim());
  };
  return (
    <form onSubmit={submit} className="grid gap-3 pt-1 pb-3" aria-label={`Correct ${name}`}>
      <div className="grid gap-1.5">
        <label htmlFor={inputId} className="text-sm font-medium text-fg">
          New {name}
        </label>
        <Input
          id={inputId}
          // The panel opens on Correct, so the field takes focus at once, with its value selected.
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          maxLength={80}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-describedby={`${inputId}-hint`}
        />
        <p id={`${inputId}-hint`} className="m-0 text-xs text-fg-3">
          Errand uses the new {name} from now on and keeps the old one only as history.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" type="submit" loading={busy} disabled={value.trim() === ""}>
          Save {name}
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function RowMenu({ fact, onCorrect, onForget }: { readonly fact: MemoryFactView; readonly onCorrect: () => void; readonly onForget: () => void }) {
  // Choosing Correct moves focus into the field that opens, not back to this button.
  const correcting = useRef(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={`More for ${fact.label.toLowerCase()}`} data-more={fact.key}>
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-40"
        onCloseAutoFocus={(event) => {
          if (correcting.current) event.preventDefault();
          correcting.current = false;
        }}
      >
        <DropdownMenuItem
          onSelect={() => {
            correcting.current = true;
            onCorrect();
          }}
        >
          <PencilLine className="text-fg-3" /> Correct
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onForget}>
          <Trash2 className="text-fg-3" /> Forget
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type FactActions = {
  readonly editing: boolean;
  readonly busy: string | undefined;
  readonly onCorrect: () => void;
  readonly onCancelCorrect: () => void;
  readonly onSave: (value: string) => void;
  readonly onForget: () => void;
  readonly onConfirm: () => void;
};

function FactRow({ fact, actions }: { readonly fact: MemoryFactView; readonly actions: FactActions }) {
  const guess = isGuess(fact);
  const inferred = fact.source === "inferred";
  return (
    <div
      data-origin={fact.source}
      data-guess={guess || undefined}
      className={cn("grid gap-2", guess ? "inferred my-1 rounded-panel border p-3" : "border-b border-line py-3")}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="m-0 flex min-w-0 items-center gap-2 text-base leading-snug font-medium text-fg">
            <CrossFade swapKey={fact.display} className="min-w-0">
              <span className="block truncate">
                {statementOf(fact)}
                {guess ? "?" : ""}
              </span>
            </CrossFade>
          </p>
          <p className="m-0 text-sm text-fg-3">
            <CrossFade swapKey={sourceOf(fact)}>{sourceOf(fact)}</CrossFade>
          </p>
        </div>
        <Badge variant={inferred ? "inferred" : "tag"} className="mt-0.5">
          {fact.source}
        </Badge>
        <RowMenu fact={fact} onCorrect={actions.onCorrect} onForget={actions.onForget} />
      </div>
      {guess && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" loading={actions.busy === `confirm:${fact.id}`} onClick={actions.onConfirm}>
            Confirm
          </Button>
          <Button size="sm" variant="ghost" onClick={actions.onForget}>
            Not right
          </Button>
        </div>
      )}
      <Presence>
        {actions.editing && (
          <Reveal key="correct" rise={0}>
            <CorrectionForm fact={fact} busy={actions.busy === `correct:${fact.key}`} onCancel={actions.onCancelCorrect} onSave={actions.onSave} />
          </Reveal>
        )}
      </Presence>
    </div>
  );
}

/**
 * The facts, the guesses, the forgotten tombstones and the replaced values. `returnFocus` is where focus
 * goes when the last row is forgotten (the sheet's Done, the panel's Close).
 */
export function MemoryFacts({
  api,
  activity = 0,
  returnFocus,
}: {
  readonly api: ApiClient;
  /** Changes whenever the chat sees new session events, so a fact changed in chat shows up here. */
  readonly activity?: number;
  readonly returnFocus?: () => void;
}) {
  const { memory, error, refresh } = useMemoryFacts(api, activity);
  const [editing, setEditing] = useState<MemoryKey>();
  const [busy, setBusy] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const list = useRef<HTMLUListElement>(null);
  const { toast, show, hold, release } = useToast();

  // Where focus goes once the list shows what the backend now serves: the row acted on if it is still
  // there, else the first row, else the caller's fallback. Never a row that is still collapsing.
  const [focusAfter, setFocusAfter] = useState<{ readonly key: MemoryKey | undefined }>();

  const act = async (label: string, action: () => Promise<unknown>, done: string, focusKey: MemoryKey | undefined) => {
    setBusy(label);
    setActionError(undefined);
    try {
      await action();
      setEditing(undefined);
      show(done);
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(undefined);
      await refresh();
      announceMemoryChange();
      setFocusAfter({ key: focusKey });
    }
  };

  const facts = memory?.facts ?? [];
  const current = facts.filter((fact) => fact.status === "active" || fact.status === "pending_confirmation");
  // Explicit and confirmed facts first; the guesses after them, each in its dashed edge.
  const ordered = [...current.filter((fact) => !isGuess(fact)), ...current.filter(isGuess)];
  const replaced = facts.filter((fact) => fact.status === "superseded");
  const tombstones = memory?.tombstones ?? [];
  // One tombstone line per key: the latest, and only while nothing new holds the key.
  const forgotten = tombstones.filter(
    (tombstone, index) =>
      tombstones.findLastIndex((other) => other.key === tombstone.key) === index && !current.some((fact) => fact.key === tombstone.key),
  );

  useEffect(() => {
    if (focusAfter === undefined) return;
    setFocusAfter(undefined);
    const keys = ordered.map((fact) => fact.key);
    const key = focusAfter.key !== undefined && keys.includes(focusAfter.key) ? focusAfter.key : keys[0];
    const target = key === undefined ? null : list.current?.querySelector<HTMLElement>(`[data-more="${key}"]`);
    if (target) target.focus();
    else returnFocus?.();
  }, [focusAfter, ordered, returnFocus]);

  const actionsFor = (fact: MemoryFactView): FactActions => {
    const name = fact.label.toLowerCase();
    return {
      editing: editing === fact.key,
      busy,
      onCorrect: () => setEditing(fact.key),
      onCancelCorrect: () => {
        setEditing(undefined);
        setFocusAfter({ key: fact.key });
      },
      onSave: (value) =>
        void act(`correct:${fact.key}`, () => api.correctMemoryFact(fact.key, { value }), `Updated your ${name}`, fact.key),
      onForget: () => void act(`forget:${fact.key}`, () => api.forgetMemoryFact(fact.key), `Forgot your ${name}`, undefined),
      onConfirm: () => void act(`confirm:${fact.id}`, () => api.confirmMemoryFact(fact.id), `Saved: ${statementOf(fact)}`, fact.key),
    };
  };

  return (
    <div className="grid gap-4" aria-busy={memory === undefined || undefined}>
      {(error ?? actionError) !== undefined && (
        <p className="m-0 rounded-md bg-danger-tint px-3 py-2 text-sm text-danger-text" role="alert">
          {actionError ?? `Can't read memory: ${error}`}
        </p>
      )}

      {memory === undefined && (
        <div aria-hidden className="grid gap-3 py-2">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-1/2" />
        </div>
      )}

      <Presence wait>
        {memory !== undefined && current.length === 0 && forgotten.length === 0 && (
          <Reveal key="empty">
            <p className="m-0 rounded-panel bg-surface px-4 py-6 text-center text-sm text-fg-2">
              Nothing remembered yet. Tell Errand your usual area or budget and ask it to remember.
            </p>
          </Reveal>
        )}
      </Presence>

      {memory !== undefined && (
        <ul ref={list} aria-label="Remembered facts" className="m-0 flex list-none flex-col p-0">
          <Presence>
            {ordered.map((fact) => (
              <Reveal as="li" key={fact.key} aria-label={statementOf(fact)}>
                <FactRow fact={fact} actions={actionsFor(fact)} />
              </Reveal>
            ))}
          </Presence>
        </ul>
      )}

      <Presence>
        {forgotten.length > 0 && (
          <Reveal as="section" key="forgotten" aria-label="Forgotten">
            <ul className="m-0 flex list-none flex-col p-0">
              <Presence>
                {forgotten.map((tombstone) => (
                  <Reveal as="li" key={tombstone.key} aria-label={`Forgotten: ${tombstone.label}`}>
                    <p className="m-0 flex items-center gap-2 py-2 text-sm text-fg-2">
                      <Trash2 aria-hidden className="size-4 flex-none text-fg-3" />
                      <span>
                        Forgot your {tombstone.label.toLowerCase()} on {day(tombstone.forgottenAt)}{" "}
                        <span className="text-fg-3 line-through">({tombstoneStatement(tombstone, facts)})</span>. It is never used
                        again.
                      </span>
                    </p>
                  </Reveal>
                ))}
              </Presence>
            </ul>
          </Reveal>
        )}
      </Presence>

      <Presence>
        {replaced.length > 0 && (
          <Reveal as="section" key="replaced" aria-label="Replaced">
            <h3 className="m-0 mb-1 text-sm font-medium text-fg-2">Replaced</h3>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              <Presence>
                {replaced.map((fact) => (
                  <Reveal as="li" key={fact.id} aria-label={`Replaced: ${statementOf(fact)}`} className="text-xs text-fg-3">
                    {statementOf(fact)} · until {fact.validTo === null ? "now" : day(fact.validTo)} · kept, never used
                  </Reveal>
                ))}
              </Presence>
            </ul>
          </Reveal>
        )}
      </Presence>

      <ToastRegion toast={toast} onHold={hold} onRelease={release} />
    </div>
  );
}
