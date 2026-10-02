import { forwardRef, type ButtonHTMLAttributes, type DragEvent, type MouseEvent, type ReactElement, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn, EASE_OUT } from './cn'
import { Tooltip } from './Tooltip'

/** Rail (global modes) · context sidebar · workspace. Only the sidebar and workspace scroll. */
export function AppShell({
  rail,
  sidebar,
  sidebarOpen,
  sidebarOverlay,
  sidebarWidth,
  onDismissSidebar,
  children
}: {
  rail: ReactNode
  sidebar: ReactNode | null
  sidebarOpen: boolean
  /** Narrow windows: the sidebar floats over the workspace instead of pushing it. */
  sidebarOverlay: boolean
  sidebarWidth: number
  onDismissSidebar: () => void
  children: ReactNode
}): ReactElement {
  const showSidebar = Boolean(sidebar) && sidebarOpen
  return (
    <div className="app-backdrop flex h-screen w-screen overflow-hidden">
      <GlassSidebar>
        {rail}
        <AnimatePresence initial={false}>
          {showSidebar && !sidebarOverlay && (
            <motion.aside
              key="sidebar"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: sidebarWidth, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: EASE_OUT }}
              className="relative flex shrink-0 flex-col overflow-hidden"
            >
              <div className="flex h-full flex-col" style={{ width: sidebarWidth }}>
                {sidebar}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </GlassSidebar>
      <div className="relative flex min-w-0 flex-1">
        <AnimatePresence initial={false}>
          {showSidebar && sidebarOverlay && (
            <motion.div
              key="scrim"
              className="absolute inset-0 z-30 bg-[var(--scrim)]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: EASE_OUT }}
              onClick={onDismissSidebar}
            />
          )}
          {showSidebar && sidebarOverlay && (
            <motion.aside
              key="drawer"
              initial={{ x: -16, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -16, opacity: 0 }}
              transition={{ duration: 0.18, ease: EASE_OUT }}
              className="glass-sidebar glass-sidebar-drawer absolute inset-y-0 left-0 z-40 flex shrink-0 flex-col overflow-hidden shadow-popover"
            >
              <div className="flex h-full flex-col" style={{ width: sidebarWidth }}>
                {sidebar}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-tl-2xl border-t border-line bg-canvas">
          {children}
        </main>
      </div>
    </div>
  )
}

/**
 * The one translucent surface behind the navigation rail and the context sidebar: a single backdrop blur on
 * this container (never on items), a thin right border and a faint inner highlight. Colours, blur radius and
 * the solid fallback (no backdrop-filter / reduced transparency) are the `sidebar.*` tokens in index.css.
 */
export function GlassSidebar({ children }: { children: ReactNode }): ReactElement {
  return <div className="glass-sidebar flex shrink-0 border-r border-[var(--sidebar-border)]">{children}</div>
}

export function NavRail({ top, bottom }: { top: ReactNode; bottom: ReactNode }): ReactElement {
  return (
    <nav aria-label="Разделы" className="flex w-14 shrink-0 flex-col items-center justify-between pb-3 pt-2">
      <div className="flex flex-col items-center gap-1">{top}</div>
      <div className="flex flex-col items-center gap-1">{bottom}</div>
    </nav>
  )
}

interface NavRailItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string
  icon: ReactNode
  active?: boolean
  shortcut?: string
  badge?: ReactNode
}

export const NavRailItem = forwardRef<HTMLButtonElement, NavRailItemProps>(function NavRailItem(
  { label, icon, active, shortcut, badge, className, ...rest },
  ref
) {
  return (
    <Tooltip label={label} shortcut={shortcut} side="right">
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors duration-fast ease-out',
          active ? 'sidebar-item-active bg-active text-fg' : 'text-fg-secondary hover:bg-hover hover:text-fg',
          className
        )}
        {...rest}
      >
        {icon}
        {badge}
      </button>
    </Tooltip>
  )
})

export function SidebarHeader({ title, actions }: { title: ReactNode; actions?: ReactNode }): ReactElement {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-2 pl-4 pr-2">
      <h2 className="truncate text-md font-semibold text-fg">{title}</h2>
      {actions && <div className="flex items-center gap-0.5">{actions}</div>}
    </div>
  )
}

export function SidebarSection({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }): ReactElement {
  return (
    <div className={cn('px-2 py-2', className)}>
      {title && <div className="px-2 pb-1 pt-1 text-xs font-medium tracking-wide text-fg-muted">{title}</div>}
      <div className="flex flex-col gap-px">{children}</div>
    </div>
  )
}

interface SidebarItemProps {
  icon?: ReactNode
  label: ReactNode
  active?: boolean
  count?: number | string
  /** Right-side status (spinner, badge); hidden while hover actions show. */
  trailing?: ReactNode
  onClick: () => void
  onContextMenu?: (e: MouseEvent) => void
  /** Actions revealed on hover / focus (e.g. a "…" menu). */
  actions?: ReactNode
  title?: string
  muted?: boolean
  /** Something is being dragged over this row (folders accept dropped notes). */
  dropActive?: boolean
  onDragOver?: (e: DragEvent) => void
  onDragLeave?: (e: DragEvent) => void
  onDrop?: (e: DragEvent) => void
}

export function SidebarItem({ icon, label, active, count, trailing, onClick, onContextMenu, actions, title, muted, dropActive, onDragOver, onDragLeave, onDrop }: SidebarItemProps): ReactElement {
  return (
    <div
      className={cn(
        'group relative flex h-8 items-center rounded-lg transition-colors duration-fast ease-out',
        active ? 'sidebar-item-active bg-active' : 'hover:bg-hover focus-within:bg-hover',
        dropActive && 'drop-target'
      )}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 text-left text-base outline-offset-[-2px]',
          active ? 'font-medium text-fg' : muted ? 'text-fg-secondary' : 'text-fg'
        )}
      >
        {icon && <span className={cn('sidebar-icon flex h-4 w-4 shrink-0 items-center justify-center', active ? 'text-fg' : 'text-fg-secondary')}>{icon}</span>}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count !== undefined && (
          <span className={cn('tabular shrink-0 text-xs text-fg-muted', Boolean(actions) && 'group-focus-within:opacity-0 group-hover:opacity-0')}>{count}</span>
        )}
        {trailing && (
          <span className={cn('flex shrink-0 items-center text-fg-muted', Boolean(actions) && 'group-focus-within:opacity-0 group-hover:opacity-0')}>{trailing}</span>
        )}
      </button>
      {actions && (
        <div className="absolute right-1 flex items-center opacity-0 transition-opacity duration-fast group-focus-within:opacity-100 group-hover:opacity-100 has-[[aria-expanded=true]]:opacity-100">
          {actions}
        </div>
      )}
    </div>
  )
}
