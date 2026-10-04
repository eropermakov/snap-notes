import { forwardRef, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes } from 'react'
import { cn } from './cn'
import { SearchIcon, ChevronDownIcon, CloseIcon } from '../components/icons'
import { Kbd } from './Badge'

const FIELD =
  'ui-field rounded-xl border border-[var(--border-input)] bg-input text-base text-fg transition-[border-color,box-shadow,background-color] duration-fast ease-out hover:border-[var(--border-strong)] focus-within:border-[var(--border-focus)] focus-within:bg-canvas focus-within:shadow-focus'

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  leading?: ReactNode
  trailing?: ReactNode
  invalid?: boolean
  wrapperClassName?: string
  size?: 'sm' | 'md'
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { leading, trailing, invalid, wrapperClassName, className, size = 'md', ...rest },
  ref
) {
  return (
    <div
      className={cn(
        'flex items-center gap-2',
        FIELD,
        size === 'sm' ? 'h-8 rounded-lg px-2.5' : 'h-9 px-3',
        invalid && 'border-danger hover:border-danger',
        wrapperClassName
      )}
    >
      {leading && <span className="flex shrink-0 text-fg-muted">{leading}</span>}
      <input ref={ref} className={cn('h-full w-full min-w-0 bg-transparent outline-none', className)} {...rest} />
      {trailing}
    </div>
  )
})

interface SearchInputProps extends Omit<InputProps, 'leading' | 'trailing' | 'onChange'> {
  value: string
  onChange: (value: string) => void
  shortcut?: string
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onChange, shortcut, ...rest },
  ref
) {
  return (
    <Input
      ref={ref}
      type="text"
      role="searchbox"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && value) {
          e.stopPropagation()
          onChange('')
        }
      }}
      leading={<SearchIcon className="h-4 w-4" />}
      trailing={
        value ? (
          <button
            type="button"
            aria-label="Очистить поиск"
            onClick={() => onChange('')}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:bg-hover hover:text-fg"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        ) : shortcut ? (
          <Kbd>{shortcut}</Kbd>
        ) : null
      }
      {...rest}
    />
  )
})

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  wrapperClassName?: string
}

/** Native select (keyboard + accessibility for free) dressed as a calm field. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ wrapperClassName, className, children, ...rest }, ref) {
  return (
    <div className={cn('relative flex h-8 items-center rounded-lg', FIELD, wrapperClassName)}>
      <select
        ref={ref}
        className={cn('h-full w-full min-w-0 cursor-default appearance-none bg-transparent pl-2.5 pr-8 text-base text-fg outline-none', className)}
        {...rest}
      >
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-fg-muted" />
    </div>
  )
})

interface NumberFieldProps {
  value: string
  onChange: (value: string) => void
  onCommit: () => void
  min: number
  max: number
  suffix?: string
  'aria-label': string
}

/** Compact numeric input that commits on blur or Enter. */
export function NumberField({ value, onChange, onCommit, min, max, suffix, ...aria }: NumberFieldProps): ReactElement {
  return (
    <div className="flex items-center gap-2">
      <Input
        size="sm"
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        wrapperClassName="w-20"
        className="tabular text-right"
        {...aria}
      />
      {suffix && <span className="text-sm text-fg-secondary">{suffix}</span>}
    </div>
  )
}

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
}

export function Toggle({ checked, onChange, disabled, ...aria }: ToggleProps): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-base ease-out disabled:opacity-45',
        checked ? 'bg-accent' : 'bg-[var(--toggle-off)]'
      )}
      {...aria}
    >
      <span
        className={cn(
          'block h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-transform duration-base ease-out',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        )}
      />
    </button>
  )
}

export interface SegmentOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
  /** Render only the icon, keep label for a11y/tooltip. */
  iconOnly?: boolean
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  'aria-label': ariaLabel,
  size = 'md'
}: {
  value: T
  onChange: (value: T) => void
  options: SegmentOption<T>[]
  'aria-label': string
  size?: 'sm' | 'md'
}): ReactElement {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('inline-flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5', size === 'sm' ? 'h-7' : 'h-8')}>
      {options.map((o) => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.iconOnly ? o.label : undefined}
            title={o.iconOnly ? o.label : undefined}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex h-full items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors duration-fast',
              o.iconOnly ? 'aspect-square' : 'px-2.5',
              selected ? 'bg-canvas text-fg shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-fg-secondary hover:text-fg'
            )}
          >
            {o.icon}
            {!o.iconOnly && o.label}
          </button>
        )
      })}
    </div>
  )
}
