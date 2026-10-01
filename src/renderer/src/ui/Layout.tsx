import { useId, type ReactElement, type ReactNode } from 'react'
import { cn } from './cn'

/** Scrollable workspace page with a readable max width. */
export function Page({ children, width = 'md', className }: { children: ReactNode; width?: 'md' | 'lg'; className?: string }): ReactElement {
  return (
    <div className="h-full overflow-y-auto">
      <div className={cn('mx-auto w-full px-8 pb-16 pt-10', width === 'md' ? 'max-w-[720px]' : 'max-w-[960px]', className)}>{children}</div>
    </div>
  )
}

export function PageHeader({
  title,
  description,
  actions,
  className
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}): ReactElement {
  return (
    <header className={cn('mb-8 flex items-start justify-between gap-6', className)}>
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold tracking-[-0.01em] text-fg">{title}</h1>
        {description && <p className="mt-2 max-w-[560px] text-base text-fg-secondary">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2 pt-1">{actions}</div>}
    </header>
  )
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
  id
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  id?: string
}): ReactElement {
  return (
    <section id={id} className={cn('mb-10 scroll-mt-6 last:mb-0', className)}>
      {(title || actions) && (
        <div className="mb-1 flex items-end justify-between gap-4">
          {title && <h2 className="text-md font-semibold text-fg">{title}</h2>}
          {actions}
        </div>
      )}
      {description && <p className="mb-2 text-sm text-fg-secondary">{description}</p>}
      {children}
    </section>
  )
}

/** Related settings, separated only by hairlines — no card per setting. */
export function SettingsGroup({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  return <div className={cn('divide-y divide-line border-y border-line', className)}>{children}</div>
}

interface SettingsRowProps {
  title: ReactNode
  description?: ReactNode
  /** Control on the right: Toggle, Select, Button, shortcut, value, input. */
  control?: ReactNode
  /** Optional full-width content under the row (expanded details, lists). */
  children?: ReactNode
  error?: ReactNode
  /** Stack control under the text (wide controls like pickers). */
  stacked?: boolean
}

export function SettingsRow({ title, description, control, children, error, stacked }: SettingsRowProps): ReactElement {
  const id = useId()
  return (
    <div className="py-3.5">
      <div className={cn('flex min-h-[32px] gap-x-8 gap-y-3', stacked ? 'flex-col' : 'items-center justify-between')}>
        <div className="min-w-0 flex-1">
          <div id={`${id}-t`} className="text-base text-fg">
            {title}
          </div>
          {description && (
            <div id={`${id}-d`} className="mt-0.5 text-sm text-fg-secondary">
              {description}
            </div>
          )}
          {error && <div className="mt-1 text-sm text-danger">{error}</div>}
        </div>
        {control && <div className={cn('flex shrink-0 items-center gap-2', stacked && 'w-full')}>{control}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  size = 'lg',
  className
}: {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  size?: 'sm' | 'lg'
  className?: string
}): ReactElement {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', size === 'lg' ? 'px-8 py-20' : 'px-6 py-10', className)}>
      {icon && <div className="mb-4 text-fg-muted">{icon}</div>}
      <h2 className={cn('text-fg', size === 'lg' ? 'text-3xl font-medium tracking-[-0.01em]' : 'text-md font-medium')}>{title}</h2>
      {description && <div className={cn('mt-2 max-w-[420px] text-fg-secondary', size === 'lg' ? 'text-base' : 'text-sm')}>{description}</div>}
      {action && <div className="mt-6 flex items-center gap-2">{action}</div>}
    </div>
  )
}
