import * as React from 'react'
import { Popover as PopoverPrimitive } from '@base-ui/react/popover'

import { cn } from '@/lib/utils'

/*
 * Measured from the reference:
 * - Opens with a short flip: from perspective(600px) rotateX(-20deg) scale(0.94) to rest over 300ms,
 *   opacity over 160ms, both on cubic-bezier(0.23, 1, 0.32, 1). Closes to scale(0.96) and opacity 0
 *   over 160ms on cubic-bezier(0.4, 0, 0.6, 1).
 * - 320px wide, 10px padding, 16px between header and body, 10px radius, a 10% foreground hairline
 *   plus shadow-md, 8px from the trigger, with a 9px arrow.
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
            'relative flex w-80 max-w-(--available-width) origin-(--transform-origin) flex-col gap-4 rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none',
            'transition-[transform,opacity] ease-[cubic-bezier(0.23,1,0.32,1)] [transition-duration:300ms,160ms]',
            'data-starting-style:[transform:perspective(600px)_rotateX(-20deg)_scale(0.94)] data-starting-style:opacity-0',
            'data-ending-style:[transform:scale(0.96)] data-ending-style:opacity-0 data-ending-style:ease-[cubic-bezier(0.4,0,0.6,1)] data-ending-style:[transition-duration:160ms]',
            'motion-reduce:transition-none',
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
        'size-[9px] rotate-45 border-foreground/10 bg-popover',
        'data-[side=bottom]:-top-[4.5px] data-[side=bottom]:rounded-tl-[2px] data-[side=bottom]:border-t data-[side=bottom]:border-l',
        'data-[side=top]:-bottom-[4.5px] data-[side=top]:rounded-br-[2px] data-[side=top]:border-r data-[side=top]:border-b',
        'data-[side=left]:-right-[4.5px] data-[side=left]:rounded-tr-[2px] data-[side=left]:border-t data-[side=left]:border-r',
        'data-[side=right]:-left-[4.5px] data-[side=right]:rounded-bl-[2px] data-[side=right]:border-b data-[side=right]:border-l',
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

/** 16px title, announced as the popover's label. */
function PopoverTitle({ className, ...props }: React.ComponentProps<typeof PopoverPrimitive.Title>) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn('text-base font-normal text-popover-foreground', className)}
      {...props}
    />
  )
}

/** 14px muted line under the title, announced as the popover's description. */
function PopoverDescription({ className, ...props }: React.ComponentProps<typeof PopoverPrimitive.Description>) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger }
export type { PopoverContentProps }
