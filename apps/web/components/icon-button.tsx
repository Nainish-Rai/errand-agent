import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

type IconButtonProps = Omit<ComponentProps<typeof Button>, "children" | "size"> & {
  /** The accessible name; icon buttons have no visible text. */
  readonly label: string;
  readonly icon: ReactNode;
  /** A count on the corner: `count` for things that need you, `alert` for failures. */
  readonly badge?: { readonly value: number; readonly tone: "count" | "alert" };
};

export function IconButton({ label, icon, badge, variant = "ghost", className, ...props }: IconButtonProps) {
  const name = badge === undefined ? label : `${label}, ${badge.value}`;
  return (
    <Button aria-label={name} title={label} size="icon" variant={variant} className={cn("relative", className)} {...props}>
      {icon}
      {badge !== undefined && (
        <Badge aria-hidden variant={badge.tone} className="absolute -top-1 -right-1">
          {badge.value}
        </Badge>
      )}
    </Button>
  );
}
