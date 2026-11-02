import { Button } from "@/components/ui/button";
import { ListRow } from "@/components/widget";

import { TrustCard } from "./trust-surface";

type ProviderCancelledAlertProps = {
  readonly provider: string;
  /** The cancelled job, e.g. "deep clean". */
  readonly service: string;
  readonly slot: string;
  /** Replacements found so far. Zero reads "finding replacements…", never "0". */
  readonly replacementsReady: number;
  readonly onSeeOptions?: () => void;
};

function replacementsLine(count: number): string {
  if (count === 0) return "finding replacements…";
  return count === 1 ? "1 replacement ready" : `${count} replacements ready`;
}

/** The provider cancelled a booking. Fixed, never generated. */
export function ProviderCancelledAlert({ provider, service, slot, replacementsReady, onSeeOptions }: ProviderCancelledAlertProps) {
  return (
    <TrustCard label={`${provider} cancelled your ${service}`} tone="alert">
      <div role="alert" className="px-3 py-2">
        <ListRow
          lead={
            <span aria-hidden className="text-err">
              ✕
            </span>
          }
          title={`${provider} cancelled your ${service}`}
          meta={`${slot} · ${replacementsLine(replacementsReady)}`}
          action={
            replacementsReady > 0 && onSeeOptions !== undefined ? (
              <Button size="sm" variant="secondary" onClick={onSeeOptions}>
                See options
              </Button>
            ) : undefined
          }
        />
      </div>
    </TrustCard>
  );
}
