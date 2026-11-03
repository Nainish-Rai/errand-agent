import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * Badges: a count (warn fill), an alert (err fill) and tags (outline). The `inferred` tag uses the
 * dashed warn edge, which is reserved for guesses: never put it on an explicit fact.
 */
const badgeVariants = cva("inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap [&>svg]:size-3", {
  variants: {
    variant: {
      count: "h-4 min-w-4 rounded-control bg-warn-tint px-1 text-xs font-semibold text-warn-text tabular-nums",
      alert: "h-4 min-w-4 rounded-control bg-danger px-1 text-xs font-semibold text-on-danger tabular-nums",
      tag: "rounded-control border border-line px-1.5 py-px text-xs text-fg-3",
      verified: "rounded-control border border-success/40 px-1.5 py-px text-xs text-success-text",
      inferred: "inferred rounded-control border px-1.5 py-px text-xs text-warn-text",
      // The eve template's names.
      default: "rounded-control border border-accent bg-accent px-1.5 py-px text-xs text-on-accent",
      secondary: "rounded-control border border-line bg-surface-2 px-1.5 py-px text-xs text-fg-2",
      outline: "rounded-control border border-line px-1.5 py-px text-xs text-fg-3",
    },
  },
  defaultVariants: {
    variant: "tag",
  },
});

function Badge({
  className,
  variant = "tag",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return <Comp data-slot="badge" data-variant={variant} className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
