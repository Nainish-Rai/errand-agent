import { cn } from "@/lib/utils";

const rupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** ₹1,050: Indian grouping, no currency code. */
export function formatRupees(amount: number): string {
  return `₹${rupees.format(amount)}`;
}

/** An amount in Geist Mono with tabular figures. */
export function Money({ amount, className }: { readonly amount: number; readonly className?: string }) {
  return <span className={cn("font-mono tabular-nums", className)}>{formatRupees(amount)}</span>;
}
