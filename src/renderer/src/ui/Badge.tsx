import type { ReactElement, ReactNode } from 'react'
import { cn } from './cn'

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-fg-secondary',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger'
}

export function Badge({ tone = 'neutral', children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }): ReactElement {
  return (
    <span className={cn('inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-sm px-1.5 text-xs font-medium', TONES[tone], className)}>
      {children}
    </span>
  )
}

const DOT_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-fg-muted',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger'
}

/** Quiet status: a dot plus plain text, no pill background. */
export function StatusDot({ tone, children, className }: { tone: BadgeTone; children?: ReactNode; className?: string }): ReactElement {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-fg-secondary', className)}>
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT_TONES[tone])} />
      {children}
    </span>
  )
}

export function Kbd({ children, inverted }: { children: ReactNode; inverted?: boolean }): ReactElement {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] items-center rounded-xs px-1 font-sans text-2xs font-medium',
        inverted ? 'text-canvas opacity-60' : 'border border-line-strong bg-surface-2 text-fg-secondary'
      )}
    >
      {children}
    </kbd>
  )
}

export function Divider({ className, vertical }: { className?: string; vertical?: boolean }): ReactElement {
  return vertical ? (
    <span aria-hidden className={cn('mx-1 h-4 w-px shrink-0 bg-line-strong', className)} />
  ) : (
    <hr className={cn('border-0 border-t border-line', className)} />
  )
}
