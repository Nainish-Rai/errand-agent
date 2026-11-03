import * as React from 'react'
import { IconChevronDown } from '@tabler/icons-react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/*
 * Errand: restyled on Lime (design-system-v3.html). A --field fill with a --line-strong edge and --radius-field;
 * focus draws Lime's ring. Colour changes over --dur-instant on --ease-out.
 */
const nativeSelectVariants = cva(
  [
    'w-full min-w-0 appearance-none rounded-field border border-line-strong bg-field text-sm text-fg outline-none',
    'transition-[color,background-color,border-color] duration-(--dur-instant) ease-out',
    'hover:border-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    'aria-invalid:border-danger',
    'disabled:pointer-events-none disabled:cursor-not-allowed',
  ],
  {
    variants: {
      size: {
        default: 'h-8 py-1 ps-2.5 pe-8',
        sm: 'h-7 py-0.5 ps-2 pe-7 text-xs',
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
          'pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-fg-3 select-none',
          size === 'sm' ? 'end-2' : 'end-2.5',
        )}
      />
    </div>
  )
}

function NativeSelectOption({ className, ...props }: React.ComponentProps<'option'>) {
  return <option data-slot="native-select-option" className={cn('bg-raised text-fg', className)} {...props} />
}

function NativeSelectOptGroup({ className, ...props }: React.ComponentProps<'optgroup'>) {
  return (
    <optgroup data-slot="native-select-optgroup" className={cn('bg-raised text-fg', className)} {...props} />
  )
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption, nativeSelectVariants }
export type { NativeSelectProps }
