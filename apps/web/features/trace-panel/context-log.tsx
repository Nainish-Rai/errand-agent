"use client";

import type { ApiClient } from "@errand/client";
import type { ContextFact, GetSessionContextResponse, ModelCallContext } from "@errand/contracts";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

// The context log beside the run trace: for each turn, what the model was sent against the fixed
// context budget (tokens per part and the cap), the remembered facts it carried and every fact it
// left out with the reason, and the history it kept, dropped and summarised. It reads
// GET /api/v1/sessions/:id/context, refetched whenever the trace gains a context event.

const REASONS: Readonly<Record<string, string>> = {
  fills_missing_detail: "fills a missing detail",
  standing_preference: "standing preference",
  matches_errand: "matches the errand",
  superseded: "superseded",
  forgotten: "forgotten",
  unconfirmed: "inferred, not confirmed",
  outside_validity: "outside its validity",
  overridden_by_errand: "overridden by this errand",
  over_budget: "over the memory budget",
};

const PARTS = [
  { key: "instructions", label: "instructions", className: "bg-ink" },
  { key: "tools", label: "tools", className: "bg-fg-3" },
  { key: "memory", label: "memory", className: "bg-fg-3" },
  { key: "history", label: "history", className: "bg-fg-3" },
] as const;

function reasonOf(reason: string): string {
  return REASONS[reason] ?? reason.replaceAll("_", " ");
}

function tokens(count: number): string {
  return count.toLocaleString("en-IN");
}

function useSessionContext(api: ApiClient, sessionId: string, contextEvents: number): GetSessionContextResponse | undefined {
  const [context, setContext] = useState<GetSessionContextResponse>();
  useEffect(() => {
    const controller = new AbortController();
    api
      .getSessionContext(sessionId, { signal: controller.signal })
      .then(setContext)
      // The trace panel already reports a backend it can't reach; a missed refetch catches up on the next event.
      .catch(() => undefined);
    return () => controller.abort();
  }, [api, sessionId, contextEvents]);
  return context;
}

interface TurnContext {
  readonly turnId: string;
  readonly calls: readonly ModelCallContext[];
}

function turnsOf(calls: readonly ModelCallContext[]): TurnContext[] {
  const turns: TurnContext[] = [];
  for (const call of calls) {
    const last = turns.at(-1);
    if (last !== undefined && last.turnId === call.turnId && call.sessionId === last.calls[0]?.sessionId) {
      turns[turns.length - 1] = { ...last, calls: [...last.calls, call] };
    } else turns.push({ turnId: call.turnId, calls: [call] });
  }
  return turns;
}

function keyOf(turn: TurnContext): string {
  return `${turn.calls[0]?.sessionId}:${turn.turnId}`;
}

function TokenBar({ call }: { readonly call: ModelCallContext }) {
  const described = PARTS.map((part) => `${part.label} ${tokens(call.tokens[part.key])}`).join(", ");
  return (
    <div
      role="img"
      aria-label={`${tokens(call.tokens.total)} of ${tokens(call.capTokens)} tokens: ${described}`}
      className="flex h-2 w-full overflow-hidden rounded-sm bg-surface-2"
    >
      {PARTS.map((part) => (
        <span key={part.key} className={part.className} style={{ width: `${(100 * call.tokens[part.key]) / call.capTokens}%` }} />
      ))}
    </div>
  );
}

function CallRow({ call, position }: { readonly call: ModelCallContext; readonly position: number }) {
  const refused = call.outcome === "refused";
  return (
    <li aria-label={`Call ${position}`} className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-fg-2">
          Call {position}
          {call.history.dropped.length > 0 && (
            <span className="text-fg-3"> · {call.history.dropped.length} older messages dropped</span>
          )}
        </span>
        <span className={cn("tabular-nums", refused ? "text-danger-text" : "text-fg-3")}>
          {refused ? `refused: ${call.overBudgetPart} over budget` : `${tokens(call.tokens.total)} / ${tokens(call.capTokens)}`}
        </span>
      </div>
      <TokenBar call={call} />
    </li>
  );
}

function FactRow({ fact }: { readonly fact: ContextFact }) {
  const inferred = fact.source === "inferred";
  return (
    <li aria-label={`${fact.label} · ${fact.display}`} className="flex items-center justify-between gap-2 text-sm">
      <span className={cn("min-w-0 truncate", fact.status === "active" ? "text-fg" : "text-fg-3")}>
        {fact.label} · {fact.display}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {inferred && <Badge variant="inferred">inferred</Badge>}
        <Badge variant="tag">{reasonOf(fact.reason)}</Badge>
      </span>
    </li>
  );
}

function ExcludedFacts({ facts }: { readonly facts: readonly ContextFact[] }) {
  const byReason = new Map<string, ContextFact[]>();
  for (const fact of facts) byReason.set(fact.reason, [...(byReason.get(fact.reason) ?? []), fact]);
  return (
    <div className="flex flex-col gap-2">
      {[...byReason].map(([reason, grouped]) => (
        <Collapsible key={reason}>
          <CollapsibleTrigger
            aria-label={`${reasonOf(reason)} (${grouped.length})`}
            className="group flex w-full items-center gap-1 text-left text-xs text-fg-2"
          >
            <ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" aria-hidden />
            {reasonOf(reason)} <span className="text-fg-3 tabular-nums">({grouped.length})</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul aria-label={`Left out: ${reasonOf(reason)}`} className="mt-1 flex flex-col gap-0.5 pl-4">
              {grouped.map((fact) => (
                <FactRow key={fact.id} fact={fact} />
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  );
}

function History({ call }: { readonly call: ModelCallContext }) {
  const { kept, dropped, summary } = call.history;
  return (
    <section aria-label="History sent" className="flex flex-col gap-1">
      <h4 className="text-xs font-semibold text-fg">History</h4>
      <p className="text-sm text-fg-2">
        Kept {kept.length} {kept.length === 1 ? "message" : "messages"}
        {dropped.length > 0 ? `, dropped the ${dropped.length} oldest` : ", dropped none"} · limit {tokens(call.historyLimitTokens)} tokens
      </p>
      {summary !== null && (
        <blockquote aria-label="Summary of the dropped messages" className="whitespace-pre-wrap rounded-sm border-l-2 border-line-strong pl-2 text-xs text-fg-3">
          {summary}
        </blockquote>
      )}
      {dropped.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-fg-2">
            <ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" aria-hidden />
            Dropped messages
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ol aria-label="Dropped messages" className="mt-1 flex flex-col gap-0.5 pl-4">
              {dropped.map((message) => (
                <li key={message.index} className="truncate text-xs text-fg-3">
                  {message.role} · {tokens(message.tokens)} · {message.preview}
                </li>
              ))}
            </ol>
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
  );
}

interface TurnProps {
  readonly turn: TurnContext;
  readonly position: number;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function Turn({ turn, position, open, onOpenChange }: TurnProps) {
  const last = turn.calls.at(-1);
  if (last === undefined) return null;
  const { included, excluded } = last.memory;
  const name = `Turn ${position} context`;
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="rounded-md border border-line bg-surface">
      <CollapsibleTrigger aria-label={name} className="group flex w-full items-center gap-2 px-2 py-1.5 text-left">
        <ChevronRight className="size-3.5 shrink-0 text-fg-3 transition-transform group-data-[state=open]:rotate-90" aria-hidden />
        <span className="flex-1 text-sm font-medium text-fg">{name}</span>
        <span className="text-xs text-fg-3 tabular-nums">
          {included.length} sent · {excluded.length} left out · {tokens(last.tokens.total)} / {tokens(last.capTokens)}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <section aria-label={name} className="flex flex-col gap-3 border-t border-line px-2 py-2">
          <ol aria-label="Model calls" className="flex flex-col gap-2">
            {turn.calls.map((call, index) => (
              <CallRow key={call.eventId} call={call} position={index + 1} />
            ))}
          </ol>
          <section aria-label="Facts sent" className="flex flex-col gap-1">
            <h4 className="text-xs font-semibold text-fg">Facts sent</h4>
            {included.length === 0 ? (
              <p className="text-sm text-fg-3">{last.memory.text === "" ? "No memory in this turn." : "None: nothing remembered applies."}</p>
            ) : (
              <ul aria-label="Facts sent" className="flex flex-col gap-0.5">
                {included.map((fact) => (
                  <FactRow key={fact.id} fact={fact} />
                ))}
              </ul>
            )}
          </section>
          {excluded.length > 0 && (
            <section aria-label="Facts left out" className="flex flex-col gap-1">
              <h4 className="text-xs font-semibold text-fg">Facts left out</h4>
              <ExcludedFacts facts={excluded} />
            </section>
          )}
          <History call={last} />
        </section>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ContextLog({ api, sessionId, contextEvents }: { readonly api: ApiClient; readonly sessionId: string; readonly contextEvents: number }) {
  const context = useSessionContext(api, sessionId, contextEvents);
  const [toggled, setToggled] = useState<Readonly<Record<string, boolean>>>({});
  const turns = turnsOf(context?.calls ?? []);
  const first = context?.calls[0];
  if (first === undefined) return null;
  const { split } = first;
  return (
    <section aria-label="Context log" className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3">
      <div>
        <h2 className="text-xs font-semibold text-fg">Context sent to the model</h2>
        <p className="text-xs text-fg-3">
          Cap <span className="tabular-nums">{tokens(first.capTokens)}</span> tokens: instructions{" "}
          <span className="tabular-nums">{tokens(split.instructions)}</span>, memory{" "}
          <span className="tabular-nums">{tokens(split.memory)}</span>, history at least{" "}
          <span className="tabular-nums">{tokens(split.history)}</span>. Counted conservatively ({first.estimator}).
        </p>
        <ul aria-label="Parts" className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-3">
          {PARTS.map((part) => (
            <li key={part.key} className="flex items-center gap-1">
              <span className={cn("inline-block size-2 rounded-sm", part.className)} aria-hidden />
              {part.label}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-2">
        {turns.map((turn, index) => (
          <Turn
            key={keyOf(turn)}
            turn={turn}
            position={index + 1}
            // The newest turn is open until the person says otherwise; earlier ones stay as they left them.
            open={toggled[keyOf(turn)] ?? index === turns.length - 1}
            onOpenChange={(open) => setToggled((current) => ({ ...current, [keyOf(turn)]: open }))}
          />
        ))}
      </div>
    </section>
  );
}
