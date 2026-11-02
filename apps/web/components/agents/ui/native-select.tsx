import * as React from 'react'
import { IconChevronDown } from '@tabler/icons-react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/*
 * Measured from the reference:
 * - 32px tall, 10px radius, 1px input border, 4px / 10px padding with 32px on the chevron side.
 *   Dark adds a 30% input fill that rises to 50% on hover.
 * - Focus moves the border to the ring colour and adds a 0.5px inner ring, over 150ms on the ease-out
 *   curve (cubic-bezier(0.23, 1, 0.32, 1)).
 * - A 16px muted chevron sits 10px from the end edge.
 */
const nativeSelectVariants = cva(
  [
    'w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent text-sm text-foreground outline-none',
    'transition-[color,background-color,border-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]',
    'dark:bg-input/30 dark:hover:bg-input/50',
    'focus-visible:border-ring focus-visible:shadow-[inset_0_0_0_0.5px_var(--ring)]',
    'aria-invalid:border-destructive aria-invalid:focus-visible:shadow-[inset_0_0_0_0.5px_var(--destructive)]',
    'disabled:pointer-events-none disabled:cursor-not-allowed',
    'motion-reduce:transition-none',
  ],
  {
    variants: {
      size: {
        default: 'h-8 py-1 ps-2.5 pe-8',
        sm: 'h-7 rounded-md py-0.5 ps-2 pe-7 text-[13px]',
      },
    },
    defaultVariants: { size: 'default' },
  },
)

type NativeSelectProps = Omit<React.ComponentProps<'select'>, 'size'> & {
  /** Control height. @default "default" (32px) */
  size?: VariantProps<typeof nativeSelectVariants>['size']
  /** Called with the selected option's value, alongside the native `onChange`. */
  onValueChange?: (value: string) => void
  /** Class for the wrapper that positions the chevron. */
  wrapperClassName?: string
}

/**
 * The platform `<select>`, styled like the custom select's trigger. Controlled with
 * `value` + `onValueChange` (or `onChange`), uncontrolled with `defaultValue`.
 */
function NativeSelect({ className, wrapperClassName, size = 'default', onChange, onValueChange, ...props }: NativeSelectProps) {
  return (
    <div
      data-slot="native-select-wrapper"
      className={cn('group/native-select relative w-fit has-[select:disabled]:opacity-50', wrapperClassName)}
    >
      <select
        data-slot="native-select"
        data-size={size}
        className={cn(nativeSelectVariants({ size }), className)}
        onChange={(event) => {
          onChange?.(event)
          onValueChange?.(event.target.value)
        }}
        {...props}
      />
      <IconChevronDown
        data-slot="native-select-icon"
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-muted-foreground select-none',
          size === 'sm' ? 'end-2' : 'end-2.5',
        )}
      />
    </div>
  )
}

function NativeSelectOption({ className, ...props }: React.ComponentProps<'option'>) {
  return <option data-slot="native-select-option" className={cn('bg-popover text-popover-foreground', className)} {...props} />
}

function NativeSelectOptGroup({ className, ...props }: React.ComponentProps<'optgroup'>) {
  return (
    <optgroup data-slot="native-select-optgroup" className={cn('bg-popover text-popover-foreground', className)} {...props} />
  )
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption, nativeSelectVariants }
export type { NativeSelectProps }
