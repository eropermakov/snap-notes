import { forwardRef, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react'
import { cn } from './cn'
import { Tooltip } from './Tooltip'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost'
export type ButtonSize = 'sm' | 'md'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-contrast hover:bg-accent-hover',
  secondary: 'border border-line-strong bg-canvas text-fg hover:bg-hover active:bg-active',
  ghost: 'text-fg-secondary hover:bg-hover hover:text-fg active:bg-active',
  danger: 'bg-danger text-white hover:bg-danger-hover',
  'danger-ghost': 'text-danger hover:bg-danger-soft active:bg-danger-soft'
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 rounded-md px-2.5 text-sm',
  md: 'h-8 gap-2 rounded-lg px-3 text-base'
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  trailing?: ReactNode
  loading?: boolean
}

/** Primary is rare (one per screen); most actions are secondary or ghost. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, trailing, loading, className, children, disabled, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-colors duration-fast ease-out',
        'disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
      {trailing}
    </button>
  )
})

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Accessible name; also shown as the tooltip. */
  label: string
  shortcut?: string
  icon: ReactNode
  size?: 'sm' | 'md' | 'lg'
  active?: boolean
  tone?: 'default' | 'danger' | 'accent'
  tooltip?: boolean
  tooltipSide?: 'top' | 'bottom' | 'right' | 'left'
}

const ICON_SIZES = {
  sm: 'h-7 w-7 rounded-md',
  md: 'h-8 w-8 rounded-lg',
  lg: 'h-9 w-9 rounded-lg'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, shortcut, icon, size = 'md', active, tone = 'default', tooltip = true, tooltipSide = 'bottom', className, type = 'button', ...rest },
  ref
) {
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      className={cn(
        'inline-flex shrink-0 items-center justify-center transition-colors duration-fast ease-out disabled:pointer-events-none disabled:opacity-40',
        ICON_SIZES[size],
        active
          ? tone === 'accent'
            ? 'bg-accent-soft text-accent'
            : 'bg-active text-fg'
          : tone === 'danger'
            ? 'text-fg-secondary hover:bg-danger-soft hover:text-danger'
            : 'text-fg-secondary hover:bg-hover hover:text-fg active:bg-active',
        className
      )}
      {...rest}
    >
      {icon}
    </button>
  )
  if (!tooltip) return button
  return (
    <Tooltip label={label} shortcut={shortcut} side={tooltipSide}>
      {button}
    </Tooltip>
  )
})

export function Spinner({ className }: { className?: string }): ReactElement {
  return (
    <span
      aria-hidden
      className={cn('inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent opacity-70', className)}
    />
  )
}

/** Inline text action, e.g. "Получить ключ ↗". Not a button-looking button. */
export function LinkButton({
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }): ReactElement {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-1 rounded-sm text-sm text-fg-secondary underline decoration-line-strong underline-offset-[3px] transition-colors duration-fast hover:text-fg hover:decoration-current disabled:opacity-50',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
