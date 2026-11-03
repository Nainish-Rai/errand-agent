// Memory rows. An explicit fact (the user said it) is solid; an inferred one uses the dashed warn
// edge, so a guess can always be told from a fact. Confirming applies only to inferred facts that
// are still waiting for the person: pass `onConfirm` for those and the row shows Confirm first.
import type { FactOrigin } from "@/components/chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type MemoryFact = {
  /** e.g. "Area · Koramangala". */
  readonly statement: string;
  readonly origin: FactOrigin;
  /** Where it came from: "you said · 2 Nov", "inferred from 3 bookings". */
  readonly source: string;
};

type MemoryFactRowProps = {
  readonly fact: MemoryFact;
  readonly onCorrect?: () => void;
  readonly onForget?: () => void;
  /** Only for an inferred fact waiting for confirmation. */
  readonly onConfirm?: () => void;
};

export function MemoryFactRow({ fact, onCorrect, onForget, onConfirm }: MemoryFactRowProps) {
  const inferred = fact.origin === "inferred";
  return (
    <div
      data-origin={fact.origin}
      className={cn("flex items-center gap-2 rounded-md border bg-surface-card px-2 py-1.5", inferred ? "inferred" : "border-edge")}
    >
      <div className="min-w-0 flex-1">
        <div className={cn("truncate", inferred ? "text-warn" : "text-fg-emph")}>{fact.statement}</div>
        <div className="font-mono text-meta text-fg-meta">{fact.source}</div>
      </div>
      <Badge variant={inferred ? "inferred" : "tag"}>{fact.origin}</Badge>
      {onConfirm !== undefined && (
        <Button size="sm" variant="secondary" onClick={onConfirm}>
          Confirm
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={onCorrect}>
        Correct
      </Button>
      <Button size="sm" variant="ghost" onClick={onForget}>
        Forget
      </Button>
    </div>
  );
}

/** A forgotten fact: a tombstone line. It is never used again, and says so. */
export function ForgottenFactRow({ statement, forgottenOn }: { readonly statement: string; readonly forgottenOn: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dotted border-edge bg-transparent px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-fg-meta line-through">{statement}</div>
        <div className="font-mono text-meta text-fg-meta">forgotten {forgottenOn} · never used again</div>
      </div>
    </div>
  );
}

type InferredFactPromptProps = {
  /** A question, e.g. "Prefers mornings?". */
  readonly question: string;
  readonly source: string;
  readonly onYes?: () => void;
  readonly onNo?: () => void;
};

/** Asks the user to confirm an inferred fact. */
export function InferredFactPrompt({ question, source, onYes, onNo }: InferredFactPromptProps) {
  return (
    <div data-origin="inferred" className="inferred flex items-center gap-2 rounded-md border bg-surface-card px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-warn">{question}</div>
        <div className="font-mono text-meta text-fg-meta">{source}</div>
      </div>
      <Button size="sm" variant="secondary" onClick={onYes}>
        Yes
      </Button>
      <Button size="sm" variant="ghost" onClick={onNo}>
        No
      </Button>
    </div>
  );
}
