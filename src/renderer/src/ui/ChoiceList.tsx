import type { KeyboardEvent, ReactElement, ReactNode } from 'react'
import { cn } from './cn'
import { CheckIcon } from '../components/icons'

export interface Choice<T extends string> {
  value: T
  label: ReactNode
  description?: ReactNode
}

/** Single choice among a few options that each need a description. Rows, hairline dividers, a check on the selected one. */
export function ChoiceList<T extends string>({
  value,
  onChange,
  options,
  'aria-label': ariaLabel
}: {
  value: T
  onChange: (value: T) => void
  options: Choice<T>[]
  'aria-label': string
}): ReactElement {
  const onKeyDown = (e: KeyboardEvent, index: number): void => {
    const delta = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
    if (!delta) return
    e.preventDefault()
    const next = options[(index + delta + options.length) % options.length]
    onChange(next.value)
    const group = (e.currentTarget as HTMLElement).parentElement
    requestAnimationFrame(() => group?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
  }

  return (
    <div role="radiogroup" aria-label={ariaLabel} className="divide-y divide-line border-y border-line">
      {options.map((o, i) => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className="group flex w-full items-center gap-4 py-3 text-left outline-offset-[-2px]"
          >
            <div className="min-w-0 flex-1">
              <div className={cn('text-base', selected ? 'font-medium text-fg' : 'text-fg')}>{o.label}</div>
              {o.description && <div className="mt-0.5 text-sm text-fg-secondary">{o.description}</div>}
            </div>
            <span
              className={cn(
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors duration-fast',
                selected ? 'bg-accent text-accent-contrast' : 'border border-line-strong group-hover:border-fg-muted'
              )}
            >
              {selected && <CheckIcon className="h-3 w-3" />}
            </span>
          </button>
        )
      })}
    </div>
  )
}
