import { cn } from "@/lib/utils";

import { Button } from "./ui/button";

type EmptyStateProps = {
  /** One line that says what is missing, e.g. "No bookings yet." */
  readonly message: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly className?: string;
};

/** One line plus one action. */
export function EmptyState({ message, actionLabel, onAction, className }: EmptyStateProps) {
  return (
    <div className={cn("grid justify-items-center gap-2 rounded-lg border border-dashed border-edge-strong p-4 text-center text-fg-meta", className)}>
      <p className="m-0">{message}</p>
      {actionLabel !== undefined && (
        <Button size="sm" variant="secondary" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
