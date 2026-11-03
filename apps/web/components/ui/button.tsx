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
    "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-control border font-medium whitespace-nowrap",
    "transition-[background-color,border-color,color,opacity,scale] duration-(--dur-instant) ease-out active:scale-(--scale-press)",
    focusRing,
    // A loading button is blocked but not faded: its in-progress label must stay readable.
    "disabled:cursor-not-allowed [&:disabled:not([aria-busy])]:opacity-45 aria-busy:cursor-progress",
    "aria-disabled:pointer-events-none aria-disabled:opacity-45",
    "aria-invalid:border-danger [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  ],
  {
    variants: {
      variant: {
        // Lime's primary: the lit lime body (the glow), one per view.
        primary: "glow glow-accent border-transparent text-on-accent",
        secondary: "border-transparent bg-surface-2 text-fg hover:bg-surface-3",
        ghost: "border-transparent bg-transparent text-fg-2 hover:bg-surface-2 hover:text-fg",
        danger: "border-transparent bg-danger-tint text-danger-text hover:bg-danger hover:text-on-danger",
        link: "border-transparent text-fg underline-offset-4 hover:underline",
        // The eve template's names, kept so its components restyle without code changes.
        default: "glow glow-accent border-transparent text-on-accent",
        outline: "border-line-strong bg-page text-fg hover:bg-surface-2",
        destructive: "border-transparent bg-danger-tint text-danger-text hover:bg-danger hover:text-on-danger",
      },
      size: {
        sm: "h-6 px-2.5 text-xs",
        md: "h-8 px-3.5 text-sm",
        default: "h-8 px-3.5 text-sm",
        xs: "h-6 px-2.5 text-xs",
        lg: "h-10 px-4 text-sm",
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
