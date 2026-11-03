import { cn } from "@/lib/utils";

export type MonogramTone = 1 | 2 | 3 | 4 | 5 | 6;

type MonogramProps = {
  /** One or two letters. Providers get initials, never photos of people. */
  readonly initials: string;
  /** Kept so callers compile: Lime has no category hue, so every monogram is the same quiet grey. */
  readonly tone?: MonogramTone;
  readonly className?: string;
};

/** A provider's initials on --surface, the v3 fallback where a photo is missing. */
export function Monogram({ initials, className }: MonogramProps) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-6 flex-none place-items-center rounded-full border border-line bg-surface text-xs font-semibold text-fg-2",
        className,
      )}
    >
      {initials}
    </span>
  );
}
