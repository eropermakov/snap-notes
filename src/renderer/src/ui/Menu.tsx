import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref
} from 'react'
import { Popover, type PopoverAnchor } from './Popover'
import type { Placement } from './position'
import { cn } from './cn'

const MenuContext = createContext<{ close: () => void }>({ close: () => undefined })

/** Lets custom menu rows (colour swatches…) close the menu after they act. */
export function useMenuClose(): () => void {
  return useContext(MenuContext).close
}

interface MenuProps {
  open: boolean
  onClose: () => void
  anchor: PopoverAnchor
  placement?: Placement
  children: ReactNode
  className?: string
  'aria-label'?: string
}

/** Dropdown / context menu surface with roving keyboard focus (↑ ↓ Home End, Enter, Esc). */
export function Menu({ open, onClose, anchor, placement = 'bottom-start', children, className, ...aria }: MenuProps): ReactElement {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => listRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? [])
    if (items.length === 0) return
    const index = items.indexOf(document.activeElement as HTMLElement)
    const focus = (i: number): void => items[(i + items.length) % items.length]?.focus()
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      focus(index + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focus(index <= 0 ? items.length - 1 : index - 1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      focus(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      focus(items.length - 1)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <Popover open={open} onClose={onClose} anchor={anchor} placement={placement} role="presentation" className={cn('min-w-[200px] p-1', className)}>
      <MenuContext.Provider value={{ close: onClose }}>
        <div ref={listRef} role="menu" tabIndex={-1} aria-label={aria['aria-label']} onKeyDown={onKeyDown} className="flex flex-col outline-none">
          {children}
        </div>
      </MenuContext.Provider>
    </Popover>
  )
}

interface MenuItemProps {
  icon?: ReactNode
  children: ReactNode
  shortcut?: string
  hint?: ReactNode
  danger?: boolean
  disabled?: boolean
  checked?: boolean
  onSelect: () => void
  /** Keep the menu open after selecting (toggles). */
  keepOpen?: boolean
}

export function MenuItem({ icon, children, shortcut, hint, danger, disabled, checked, onSelect, keepOpen }: MenuItemProps): ReactElement {
  const { close } = useContext(MenuContext)
  const run = (): void => {
    if (disabled) return
    if (!keepOpen) close()
    onSelect()
  }
  return (
    <div
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      tabIndex={-1}
      onClick={run}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          run()
        }
      }}
      onMouseMove={(e) => {
        if (!disabled && document.activeElement !== e.currentTarget) e.currentTarget.focus()
      }}
      className={cn(
        'flex h-8 cursor-default items-center gap-2.5 rounded-lg px-2 text-base outline-none transition-colors duration-fast',
        disabled
          ? 'text-fg-disabled'
          : danger
            ? 'text-danger focus:bg-danger-soft'
            : 'text-fg focus:bg-hover'
      )}
    >
      {icon && <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center', danger ? 'text-danger' : 'text-fg-secondary')}>{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 text-sm text-fg-muted">{hint}</span>}
      {shortcut && <span className="shrink-0 text-xs text-fg-muted">{shortcut}</span>}
      {checked !== undefined && (
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', checked ? 'bg-accent' : 'bg-transparent')} aria-hidden />
      )}
    </div>
  )
}

export function MenuSeparator(): ReactElement {
  return <div role="separator" className="-mx-1 my-1 h-px bg-line" />
}

export function MenuLabel({ children }: { children: ReactNode }): ReactElement {
  return <div className="px-2 pb-1 pt-1.5 text-xs font-medium text-fg-muted">{children}</div>
}

interface TriggerProps {
  ref: Ref<HTMLButtonElement>
  onClick: (e: MouseEvent) => void
  'aria-haspopup': 'menu'
  'aria-expanded': boolean
}

/** Menu opened from a trigger button. The trigger is a render prop so any Button/IconButton works. */
export function DropdownMenu({
  trigger,
  children,
  placement = 'bottom-end',
  className,
  label
}: {
  trigger: (props: TriggerProps) => ReactElement
  children: ReactNode
  placement?: Placement
  className?: string
  label?: string
}): ReactElement {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  return (
    <>
      {trigger({
        ref: setAnchor,
        onClick: (e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        },
        'aria-haspopup': 'menu',
        'aria-expanded': open
      })}
      <Menu open={open} onClose={close} anchor={anchor} placement={placement} className={className} aria-label={label}>
        {children}
      </Menu>
    </>
  )
}

/** Right-click menu: spread `onContextMenu` on the target and render <Menu {...menu}>. */
export function useContextMenu(): {
  onContextMenu: (e: MouseEvent) => void
  menu: { open: boolean; onClose: () => void; anchor: PopoverAnchor; placement: Placement }
} {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null)
  const onClose = useCallback(() => setPoint(null), [])
  return {
    onContextMenu: (e) => {
      e.preventDefault()
      e.stopPropagation()
      setPoint({ x: e.clientX, y: e.clientY })
    },
    menu: { open: point !== null, onClose, anchor: point, placement: 'bottom-start' }
  }
}
