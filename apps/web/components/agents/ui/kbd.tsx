import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/**
 * Size steps measured from the reference: height, minimum width, radius, side padding and type.
 * sm 16px / 10px type, md 20px / 12px, lg 24px / 13px, xl 28px / 14px.
 */
const kbdSizes = {
  sm: 'h-4 min-w-4 rounded-sm px-1 text-[10px]/[1.5]',
  md: 'h-5 min-w-5 rounded-sm px-1 text-xs',
  lg: 'h-6 min-w-6 rounded-md px-1.5 text-[13px]/[1.5]',
  xl: 'h-7 min-w-7 rounded-lg px-2 text-sm',
} as const

const kbdVariants = cva(
  [
    'pointer-events-none inline-flex w-fit items-center justify-center gap-1 border border-border bg-muted font-sans font-normal text-foreground select-none tabular-nums',
    "[&_svg:not([class*='size-'])]:size-3",
  ],
  {
    variants: { size: kbdSizes },
    defaultVariants: { size: 'xl' },
  },
)

type KbdProps = React.ComponentProps<'kbd'> & {
  /** Key cap size. @default "xl" (28px) */
  size?: VariantProps<typeof kbdVariants>['size']
}

/** A single key cap. */
function Kbd({ className, size = 'xl', ...props }: KbdProps) {
  return <kbd data-slot="kbd" data-size={size} className={cn(kbdVariants({ size }), className)} {...props} />
}

/** A row of key caps that make one shortcut, 4px apart. */
function KbdGroup({ className, ...props }: React.ComponentProps<'kbd'>) {
  return <kbd data-slot="kbd-group" className={cn('inline-flex items-center gap-1', className)} {...props} />
}

export { Kbd, KbdGroup, kbdSizes, kbdVariants }
export type { KbdProps }
