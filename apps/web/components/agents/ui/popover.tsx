import * as React from 'react'
import { Popover as PopoverPrimitive } from '@base-ui/react/popover'

import { cn } from '@/lib/utils'

/*
 * Errand: restyled on Lime (design-system-v3.html). A --raised panel with --radius-panel and --shadow-menu. It opens
 * from --scale-enter over --dur-base on --ease-out and closes over --dur-fast on --ease-in; no flip.
 */

/** Root. `open` / `defaultOpen` / `onOpenChange` control visibility; `modal` traps focus and scroll. */
function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

/** The element that toggles the popover. Use `render={<Button variant="outline" />}` to style it. */
function PopoverTrigger(props: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

type PopoverContentProps = React.ComponentProps<typeof PopoverPrimitive.Popup> &
  Pick<
    React.ComponentProps<typeof PopoverPrimitive.Positioner>,
    'side' | 'sideOffset' | 'align' | 'alignOffset' | 'collisionPadding' | 'anchor'
  > & {
    /** Draw the arrow pointing at the trigger. @default true */
    showArrow?: boolean
    /** Container for the portal. Defaults to `document.body`. */
    container?: React.ComponentProps<typeof PopoverPrimitive.Portal>['container']
  }

/** The floating panel: portal, positioner and popup in one. */
function PopoverContent({
  className,
  side = 'bottom',
  sideOffset = 8,
  align = 'center',
  alignOffset = 0,
  collisionPadding = 8,
  anchor,
  showArrow = true,
  container,
  children,
  ...props
}: PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Positioner
        data-slot="popover-positioner"
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        collisionPadding={collisionPadding}
        anchor={anchor}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            'relative z-(--z-popover) flex w-(--popover) max-w-(--available-width) origin-(--transform-origin) flex-col gap-4 rounded-panel bg-raised p-3 text-sm text-fg shadow-menu outline-none',
            'transition-[scale,opacity] duration-(--dur-base) ease-out',
            'data-starting-style:scale-(--scale-enter) data-starting-style:opacity-0',
            'data-ending-style:opacity-0 data-ending-style:duration-(--dur-fast) data-ending-style:ease-in',
            className,
          )}
          {...props}
        >
          {showArrow && <PopoverArrow />}
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverArrow({ className, ...props }: React.ComponentProps<typeof PopoverPrimitive.Arrow>) {
  return (
    <PopoverPrimitive.Arrow
      data-slot="popover-arrow"
      className={cn(
        'size-[9px] rotate-45 border-line bg-raised',
        'data-[side=bottom]:-top-[4.5px] data-[side=bottom]:border-t data-[side=bottom]:border-l',
        'data-[side=top]:-bottom-[4.5px] data-[side=top]:border-r data-[side=top]:border-b',
        'data-[side=left]:-right-[4.5px] data-[side=left]:border-t data-[side=left]:border-r',
        'data-[side=right]:-left-[4.5px] data-[side=right]:border-b data-[side=right]:border-l',
        className,
      )}
      {...props}
    />
  )
}

/** Stacks the title and description 2px apart. */
function PopoverHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="popover-header" className={cn('flex flex-col gap-0.5', className)} {...props} />
}

/** --text-base semibold title, announced as the popover's label. */
function PopoverTitle({ className, ...props }: React.ComponentProps<typeof PopoverPrimitive.Title>) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn('text-base font-semibold text-fg', className)}
      {...props}
    />
  )
}

/** 14px muted line under the title, announced as the popover's description. */
function PopoverDescription({ className, ...props }: React.ComponentProps<typeof PopoverPrimitive.Description>) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn('text-sm text-fg-3', className)}
      {...props}
    />
  )
}

export { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger }
export type { PopoverContentProps }
