import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

import { Spinner } from "./spinner";

/** The focus ring, shared so other interactive parts (chips, tabs, rows) match buttons. */
export const focusRing =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border font-medium whitespace-nowrap",
    "transition-[background-color,border-color,color,opacity]",
    focusRing,
    // A loading button is blocked but not faded: its in-progress label must stay readable.
    "disabled:cursor-not-allowed [&:disabled:not([aria-busy])]:opacity-45 aria-busy:cursor-progress",
    "aria-disabled:pointer-events-none aria-disabled:opacity-45",
    "aria-invalid:border-err [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  ],
  {
    variants: {
      variant: {
        primary: "border-primary bg-primary text-primary-foreground hover:bg-primary/85",
        secondary: "border-edge-strong bg-surface-card text-fg-emph hover:bg-surface-raised",
        ghost: "border-transparent bg-transparent text-fg-body hover:bg-surface-raised hover:text-fg-emph",
        danger: "border-err/40 bg-err-tint text-err hover:border-err/70",
        link: "border-transparent text-interactive underline-offset-4 hover:underline",
        // The eve template's names, kept so its components restyle without code changes.
        default: "border-primary bg-primary text-primary-foreground hover:bg-primary/85",
        outline: "border-edge-strong bg-transparent text-fg-emph hover:bg-surface-raised",
        destructive: "border-err/40 bg-err-tint text-err hover:border-err/70",
      },
      size: {
        sm: "h-6 px-2 text-meta",
        md: "h-8 px-3 text-label",
        default: "h-8 px-3 text-label",
        xs: "h-6 px-2 text-meta",
        lg: "h-10 px-4 text-body",
        icon: "size-8",
        "icon-xs": "size-6",
        "icon-sm": "size-7",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    readonly asChild?: boolean;
    /** Shows a spinner, sets aria-busy and blocks clicks. Pass the in-progress label as children. */
    readonly loading?: boolean;
  };

function Button({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant ?? "default"}
      data-size={size ?? "md"}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading && <Spinner aria-hidden className="size-3 border-current border-r-transparent" />}
          {children}
        </>
      )}
    </Comp>
  );
}

export { Button, buttonVariants };
