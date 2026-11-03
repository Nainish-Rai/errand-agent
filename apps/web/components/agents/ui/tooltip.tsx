import * as React from 'react'
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import { motion as limeMotion } from '@errand/design-tokens'
import { useReducedMotion } from 'motion/react'
import { TextMorph } from 'torph/react'

import { cn } from '@/lib/utils'

/*
 * Errand: restyled on Lime (design-system-v3.html). The ink tooltip: --ink fill, --fg-inverse text, --radius-md,
 * --text-xs. It opens from --scale-enter over --dur-base on --ease-out and leaves over --dur-fast on --ease-in;
 * reduced motion zeroes both through the tokens.
 */
/** --ease-out as a CSS easing string for TextMorph, which takes no custom property. */
const EASE_OUT = `cubic-bezier(${limeMotion.easeOut.join(', ')})`

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
          'transition-[top,left,right,bottom,transform] duration-(--dur-base) ease-out data-instant:transition-none',
        )}
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            'relative inline-flex h-(--popup-height,auto) w-(--popup-width,auto) max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs whitespace-nowrap',
            'bg-ink text-fg-inverse shadow-menu',
            'transition-[opacity,scale,width,height] duration-(--dur-base) ease-out',
            'data-starting-style:scale-(--scale-enter) data-starting-style:opacity-0',
            'data-ending-style:opacity-0 data-ending-style:duration-(--dur-fast) data-ending-style:ease-in',
            'data-instant:transition-none',
            // A shortcut inside the label sits tight to the right edge in translucent caps.
            'has-data-[slot=kbd]:pr-1.5',
            '**:data-[slot=kbd-group]:gap-0.5',
            '**:data-[slot=kbd]:h-[18px] **:data-[slot=kbd]:min-w-[18px] **:data-[slot=kbd]:rounded-sm **:data-[slot=kbd]:border-transparent **:data-[slot=kbd]:px-1 **:data-[slot=kbd]:text-xs',
            '**:data-[slot=kbd]:bg-fg-inverse/20 **:data-[slot=kbd]:text-inherit',
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
        'size-[9px] rotate-45 rounded-[inherit] bg-ink',
        'data-[side=top]:-bottom-1 data-[side=bottom]:-top-1 data-[side=left]:-right-1 data-[side=right]:-left-1',
        'transition-[left,top] duration-(--dur-base) ease-out data-instant:transition-none',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Wrap the content of a shared tooltip so it slides 8px in the direction the pointer travelled
 * between triggers while cross-fading (--dur-base).
 */
function TooltipViewport({ className, ...props }: React.ComponentProps<typeof TooltipPrimitive.Viewport>) {
  return (
    <TooltipPrimitive.Viewport
      data-slot="tooltip-viewport"
      className={cn(
        'relative inline-flex items-center',
        '**:data-current:inline-flex **:data-current:items-center **:data-current:gap-1.5 **:data-previous:inline-flex **:data-previous:items-center **:data-previous:gap-1.5',
        '**:data-current:transition-[translate,opacity] **:data-previous:transition-[translate,opacity] **:data-current:duration-(--dur-base) **:data-previous:duration-(--dur-base)',
        '**:data-current:ease-out **:data-previous:ease-in',
        'data-[activation-direction~=right]:**:data-current:data-starting-style:translate-x-2 data-[activation-direction~=right]:**:data-current:data-starting-style:opacity-0',
        'data-[activation-direction~=left]:**:data-current:data-starting-style:-translate-x-2 data-[activation-direction~=left]:**:data-current:data-starting-style:opacity-0',
        'data-[activation-direction~=right]:**:data-previous:data-ending-style:-translate-x-2 data-[activation-direction~=right]:**:data-previous:data-ending-style:opacity-0',
        'data-[activation-direction~=left]:**:data-previous:data-ending-style:translate-x-2 data-[activation-direction~=left]:**:data-previous:data-ending-style:opacity-0',
        'data-instant:**:data-current:transition-none data-instant:**:data-previous:transition-none',
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
 * Tooltip text that morphs when it changes (e.g. "Add to library" to "Added to library"), over --dur-base on
 * --ease-out, and the tooltip resizes with it. Reduced motion swaps the text at once.
 */
function Caption({ className, ...props }: CaptionProps) {
  const reduced = useReducedMotion() ?? false
  return (
    <span data-slot="tooltip-caption" className={cn('inline-block whitespace-nowrap', className)}>
      <TextMorph duration={reduced ? 0 : limeMotion.base} ease={EASE_OUT} {...props} />
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
