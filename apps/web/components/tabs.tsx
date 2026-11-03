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
      <TabsPrimitive.List aria-label={label} className="flex gap-4 border-b border-line text-xs">
        {items.map((item) => (
          <TabsPrimitive.Trigger
            key={item.value}
            value={item.value}
            className={cn(
              focusRing,
              "-mb-px border-b-2 border-transparent pb-1.5 text-fg-3 transition-colors duration-(--dur-instant) ease-out hover:text-fg-2 disabled:opacity-45",
              "data-[state=active]:border-fg data-[state=active]:text-fg",
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <>
                {" "}
                <span className="ml-0.5 text-fg tabular-nums">{item.count}</span>
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
      className={cn("inline-flex rounded-control bg-surface-2 p-0.5", className)}
    >
      {items.map((item) => (
        <ToggleGroup.Item
          key={item.value}
          value={item.value}
          className={cn(
            focusRing,
            "rounded-control px-2.5 py-0.5 text-xs text-fg-3 transition-colors duration-(--dur-instant) ease-out hover:text-fg-2",
            "data-[state=on]:bg-raised data-[state=on]:text-fg data-[state=on]:shadow-card",
          )}
        >
          {item.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
