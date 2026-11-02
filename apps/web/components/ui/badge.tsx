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
      count: "h-4 min-w-4 rounded-sm bg-warn-fill px-1 font-mono text-meta font-semibold text-on-warn-fill tabular-nums",
      alert: "h-4 min-w-4 rounded-sm bg-err-fill px-1 font-mono text-meta font-semibold text-on-err-fill tabular-nums",
      tag: "rounded-sm border border-edge px-1.5 py-px text-meta text-fg-meta",
      verified: "rounded-sm border border-ok/40 px-1.5 py-px text-meta text-ok",
      inferred: "inferred rounded-sm border px-1.5 py-px text-meta text-warn",
      // The eve template's names.
      default: "rounded-sm border border-primary bg-primary px-1.5 py-px text-meta text-primary-foreground",
      secondary: "rounded-sm border border-edge bg-surface-raised px-1.5 py-px text-meta text-fg-body",
      outline: "rounded-sm border border-edge px-1.5 py-px text-meta text-fg-meta",
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
