"use client";

import { Tabs as TabsPrimitive, ToggleGroup } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { focusRing } from "./ui/button";

export type TabItem<Value extends string> = {
  readonly value: Value;
  readonly label: string;
  /** A count beside the label, e.g. "Running 1". */
  readonly count?: number;
};

type UnderlineTabsProps<Value extends string> = {
  readonly items: readonly TabItem<Value>[];
  readonly value: Value;
  readonly onValueChange: (value: Value) => void;
  readonly label: string;
  /** Tab panels, as TabPanel elements. Leave out when the tabs only switch what the caller shows. */
  readonly children?: ReactNode;
  readonly className?: string;
};

/** The composer's tabs (New errand / Running N): an underline on the selected tab. */
export function UnderlineTabs<Value extends string>({ items, value, onValueChange, label, children, className }: UnderlineTabsProps<Value>) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={(next) => onValueChange(next as Value)} className={className}>
      <TabsPrimitive.List aria-label={label} className="flex gap-4 border-b border-edge text-label">
        {items.map((item) => (
          <TabsPrimitive.Trigger
            key={item.value}
            value={item.value}
            className={cn(
              focusRing,
              "pb-1.5 text-fg-meta transition-colors hover:text-fg-body disabled:opacity-45",
              "data-[state=active]:text-fg-emph data-[state=active]:shadow-[inset_0_-2px_0_var(--fg-emph)]",
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <>
                {" "}
                <span className="ml-0.5 font-mono text-fg-emph tabular-nums">{item.count}</span>
              </>
            )}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {children}
    </TabsPrimitive.Root>
  );
}

export const TabPanel = TabsPrimitive.Content;

type SegmentedControlProps<Value extends string> = {
  readonly items: readonly TabItem<Value>[];
  readonly value: Value;
  readonly onValueChange: (value: Value) => void;
  readonly label: string;
  readonly className?: string;
};

/** A small exclusive choice, e.g. "14 days / Month" on a widget. */
export function SegmentedControl<Value extends string>({ items, value, onValueChange, label, className }: SegmentedControlProps<Value>) {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      // Radix sends "" when the selected item is pressed again; a segmented control always has a value.
      onValueChange={(next) => next !== "" && onValueChange(next as Value)}
      className={cn("inline-flex rounded-md border border-edge bg-surface-well p-0.5", className)}
    >
      {items.map((item) => (
        <ToggleGroup.Item
          key={item.value}
          value={item.value}
          className={cn(
            focusRing,
            "rounded-sm px-2 py-0.5 text-label text-fg-meta transition-colors hover:text-fg-body",
            "data-[state=on]:bg-surface-raised data-[state=on]:text-fg-emph",
          )}
        >
          {item.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
