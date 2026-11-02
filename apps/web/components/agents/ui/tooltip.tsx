import * as React from 'react'
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import { TextMorph } from 'torph/react'

import { cn } from '@/lib/utils'

/*
 * Measured from the reference:
 * - Opens after ~200ms. Fades in over 200ms and out over 100ms on cubic-bezier(0.22, 1, 0.36, 1),
 *   starting from scale 0.95 and leaving at scale 0.98 (only opacity is transitioned).
 * - 13px text, 6px / 10px padding, 10px radius, 6px from the trigger. Light: foreground fill with
 *   background text. Dark: popover fill, a 15% white hairline and a soft drop shadow.
 * - Shared tooltips (one handle, several triggers) glide between triggers over 200ms and their content
 *   slides 8px in the direction of travel while cross-fading.
 */
const EASE = 'ease-[cubic-bezier(0.22,1,0.36,1)]'

/** Shares the open delay between tooltips so moving across a toolbar opens the next one instantly. */
function TooltipProvider({ delay = 200, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delay={delay} {...props} />
}

/**
 * Root. `open` / `defaultOpen` / `onOpenChange` control visibility. Pass a `handle` from
 * `createTooltipHandle()` to share one tooltip between detached triggers.
 */
function Tooltip<Payload = unknown>(props: TooltipPrimitive.Root.Props<Payload>) {
  return <TooltipPrimitive.Root<Payload> {...props} />
}

/** The element that opens the tooltip on hover or focus. Use `render` to make it your own button. */
function TooltipTrigger<Payload = unknown>({ delay = 200, ...props }: TooltipPrimitive.Trigger.Props<Payload> & React.RefAttributes<HTMLElement>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" delay={delay} {...props} />
}

type TooltipContentProps = React.ComponentProps<typeof TooltipPrimitive.Popup> &
  Pick<
    React.ComponentProps<typeof TooltipPrimitive.Positioner>,
    'side' | 'sideOffset' | 'align' | 'alignOffset' | 'collisionPadding' | 'anchor'
  > & {
    /** Draw a small arrow pointing at the trigger. @default false */
    showArrow?: boolean
    /** Container for the portal. Defaults to `document.body`. */
    container?: React.ComponentProps<typeof TooltipPrimitive.Portal>['container']
  }

/** The floating label: portal, positioner and popup in one. */
function TooltipContent({
  className,
  side = 'top',
  sideOffset = 6,
  align = 'center',
  alignOffset = 0,
  collisionPadding = 8,
  anchor,
  showArrow = false,
  container,
  children,
  ...props
}: TooltipContentProps) {
  return (
    <TooltipPrimitive.Portal container={container}>
      <TooltipPrimitive.Positioner
        data-slot="tooltip-positioner"
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        collisionPadding={collisionPadding}
        anchor={anchor}
        className={cn(
          'isolate z-50 h-(--positioner-height) w-(--positioner-width) max-w-(--available-width)',
          'transition-[top,left,right,bottom,transform] duration-200 data-instant:transition-none motion-reduce:transition-none',
          EASE,
        )}
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            'relative inline-flex h-(--popup-height,auto) w-(--popup-width,auto) max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px]/[1.5] whitespace-nowrap',
            'bg-foreground text-background dark:bg-popover dark:text-popover-foreground',
            'dark:shadow-[0_0_0_1px_rgb(255_255_255/0.15),0_2px_8px_0_rgb(0_0_0/0.4)]',
            'transition-[opacity,width,height] duration-200',
            EASE,
            'data-starting-style:scale-95 data-starting-style:opacity-0',
            'data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:duration-100',
            'data-instant:transition-none motion-reduce:transition-none',
            // A shortcut inside the label sits tight to the right edge in translucent caps.
            'has-data-[slot=kbd]:pr-1.5',
            '**:data-[slot=kbd-group]:gap-0.5',
            '**:data-[slot=kbd]:h-[18px] **:data-[slot=kbd]:min-w-[18px] **:data-[slot=kbd]:rounded-sm **:data-[slot=kbd]:border-transparent **:data-[slot=kbd]:px-1 **:data-[slot=kbd]:text-[11px]/[1.333]',
            '**:data-[slot=kbd]:bg-background/20 **:data-[slot=kbd]:text-inherit dark:**:data-[slot=kbd]:bg-foreground/10',
            className,
          )}
          {...props}
        >
          {showArrow && <TooltipArrow />}
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

/** A 9px rotated square that points at the trigger. Rendered by `TooltipContent showArrow`, or place it yourself. */
function TooltipArrow({ className, ...props }: React.ComponentProps<typeof TooltipPrimitive.Arrow>) {
  return (
    <TooltipPrimitive.Arrow
      data-slot="tooltip-arrow"
      className={cn(
        'size-[9px] rotate-45 rounded-[2px] bg-foreground dark:bg-popover',
        'data-[side=top]:-bottom-1 data-[side=bottom]:-top-1 data-[side=left]:-right-1 data-[side=right]:-left-1',
        'transition-[left,top] duration-200 data-instant:transition-none motion-reduce:transition-none',
        EASE,
        className,
      )}
      {...props}
    />
  )
}

/**
 * Wrap the content of a shared tooltip so it slides 8px in the direction the pointer travelled
 * between triggers while cross-fading (200ms).
 */
function TooltipViewport({ className, ...props }: React.ComponentProps<typeof TooltipPrimitive.Viewport>) {
  return (
    <TooltipPrimitive.Viewport
      data-slot="tooltip-viewport"
      className={cn(
        'relative inline-flex items-center',
        '**:data-current:inline-flex **:data-current:items-center **:data-current:gap-1.5 **:data-previous:inline-flex **:data-previous:items-center **:data-previous:gap-1.5',
        '**:data-current:transition-[translate,opacity] **:data-previous:transition-[translate,opacity] **:data-current:duration-200 **:data-previous:duration-200',
        '**:data-current:ease-[cubic-bezier(0.22,1,0.36,1)] **:data-previous:ease-[cubic-bezier(0.22,1,0.36,1)]',
        'data-[activation-direction~=right]:**:data-current:data-starting-style:translate-x-2 data-[activation-direction~=right]:**:data-current:data-starting-style:opacity-0',
        'data-[activation-direction~=left]:**:data-current:data-starting-style:-translate-x-2 data-[activation-direction~=left]:**:data-current:data-starting-style:opacity-0',
        'data-[activation-direction~=right]:**:data-previous:data-ending-style:-translate-x-2 data-[activation-direction~=right]:**:data-previous:data-ending-style:opacity-0',
        'data-[activation-direction~=left]:**:data-previous:data-ending-style:translate-x-2 data-[activation-direction~=left]:**:data-previous:data-ending-style:opacity-0',
        'data-instant:**:data-current:transition-none data-instant:**:data-previous:transition-none motion-reduce:**:data-current:transition-none motion-reduce:**:data-previous:transition-none',
        className,
      )}
      {...props}
    />
  )
}

type CaptionProps = Omit<React.ComponentProps<typeof TextMorph>, 'children'> & {
  /** The text. Changing it morphs letter by letter instead of swapping. */
  children: string
}

/**
 * Tooltip text that morphs when it changes (e.g. "Add to library" to "Added to library"):
 * 200ms on cubic-bezier(0.22, 1, 0.36, 1), and the tooltip resizes with it.
 */
function Caption({ className, duration = 200, ease = 'cubic-bezier(0.22, 1, 0.36, 1)', ...props }: CaptionProps) {
  return (
    <span data-slot="tooltip-caption" className={cn('inline-block whitespace-nowrap', className)}>
      <TextMorph duration={duration} ease={ease} {...props} />
    </span>
  )
}

/** Creates a handle that links detached `TooltipTrigger`s to one `Tooltip` (with an optional typed payload). */
const createTooltipHandle = TooltipPrimitive.createHandle

export {
  Caption,
  createTooltipHandle,
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  TooltipViewport,
}
export type { CaptionProps, TooltipContentProps }
