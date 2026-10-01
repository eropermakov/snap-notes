import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useAppStore } from '../store/useAppStore'
import { cn, Kbd, motionPresets } from '../ui'
import {
  DownloadIcon,
  GearIcon,
  GridIcon,
  InboxIcon,
  ListIcon,
  NotesIcon,
  PanelLeftIcon,
  PinIcon,
  PlusIcon,
  QuestionIcon,
  RefreshIcon,
  ScanDocIcon,
  SearchIcon,
  TrashIcon
} from './icons'
import { SETTINGS_CATEGORIES } from './Settings'
import { byRecent, matchesQuery, noteLabel } from './notes/noteFilters'

interface Command {
  id: string
  group: string
  label: string
  icon: ReactNode
  hint?: string
  keywords?: string
  run: () => void
}

/** Ctrl+K: every action and every note, one keyboard-driven list. */
export default function CommandPalette(): ReactElement {
  const open = useAppStore((s) => s.commandOpen)
  const setOpen = useAppStore((s) => s.setCommandOpen)
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          {...motionPresets.fade}
          className="fixed inset-0 z-[330] flex justify-center bg-[var(--scrim)] px-6 pt-[12vh]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false)
          }}
        >
          <PaletteBody onClose={() => setOpen(false)} />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

function PaletteBody({ onClose }: { onClose: () => void }): ReactElement {
  const s = useAppStore()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    inputRef.current?.focus()
    return () => previous?.focus?.()
  }, [])

  const commands = useMemo<Command[]>(() => {
    const actions: Command[] = [
      { id: 'new', group: 'Действия', label: 'Новая заметка', icon: <PlusIcon />, hint: 'Ctrl+N', run: () => void s.createNote() },
      {
        id: 'doc',
        group: 'Действия',
        label: 'Документ из скриншота',
        icon: <ScanDocIcon />,
        keywords: 'скан захват',
        run: () => void window.api.app.captureDocument()
      },
      { id: 'search', group: 'Действия', label: 'Поиск по заметкам', icon: <SearchIcon />, hint: 'Ctrl+F', run: s.focusSearch },
      {
        id: 'view',
        group: 'Действия',
        label: s.viewMode === 'grid' ? 'Показать списком' : 'Показать сеткой',
        icon: s.viewMode === 'grid' ? <ListIcon /> : <GridIcon />,
        keywords: 'вид сетка список',
        run: () => s.setViewMode(s.viewMode === 'grid' ? 'list' : 'grid')
      },
      {
        id: 'sidebar',
        group: 'Действия',
        label: (s.layoutNarrow ? s.drawerOpen : s.sidebarOpen) ? 'Скрыть боковую панель' : 'Показать боковую панель',
        icon: <PanelLeftIcon />,
        hint: 'Ctrl+\\',
        run: s.toggleSidebar
      },
      {
        id: 'docx',
        group: 'Действия',
        label: 'Экспортировать заметки в Word',
        icon: <DownloadIcon />,
        keywords: 'docx экспорт',
        run: () =>
          void window.api.settings.exportNotesDocx().then((r) => {
            if (r.ok) s.pushToast('success', `Документ Word сохранён: ${r.path}`)
            else if (!r.canceled) s.pushToast('error', r.message ?? 'Не удалось экспортировать в Word.')
          })
      },
      {
        id: 'updates',
        group: 'Действия',
        label: 'Проверить обновления',
        icon: <RefreshIcon />,
        run: () => void window.api.app.checkForUpdates().then((r) => s.pushToast(r.ok ? 'success' : 'warning', r.message))
      },
      { id: 'go-all', group: 'Перейти', label: 'Все заметки', icon: <InboxIcon />, run: () => s.setNotesFilter('all') },
      { id: 'go-pinned', group: 'Перейти', label: 'Закреплённые', icon: <PinIcon />, run: () => s.setNotesFilter('pinned') },
      { id: 'go-trash', group: 'Перейти', label: 'Корзина', icon: <TrashIcon />, run: () => s.setNotesFilter('trash') },
      { id: 'go-help', group: 'Перейти', label: 'Справка', icon: <QuestionIcon />, run: s.openInstructions },
      ...SETTINGS_CATEGORIES.map((c) => ({
        id: `settings-${c.id}`,
        group: 'Настройки',
        label: `Настройки: ${c.label}`,
        icon: <GearIcon />,
        hint: c.id === 'general' ? 'Ctrl+,' : undefined,
        run: () => s.openSettings(c.id)
      }))
    ]
    const q = query.trim().toLowerCase()
    const filteredActions = q ? actions.filter((a) => `${a.label} ${a.keywords ?? ''}`.toLowerCase().includes(q)) : actions
    const notes = s.notes
      .filter((n) => matchesQuery(n, query))
      .sort(byRecent)
      .slice(0, q ? 20 : 5)
      .map<Command>((n) => ({
        id: `note-${n.id}`,
        group: q ? 'Заметки' : 'Недавние заметки',
        label: `${n.emoji ? `${n.emoji} ` : ''}${noteLabel(n)}`,
        icon: <NotesIcon />,
        run: () => s.openNote(n.id)
      }))
    return q ? [...notes, ...filteredActions] : [...filteredActions.slice(0, 7), ...notes, ...filteredActions.slice(7)]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, s.notes, s.viewMode, s.sidebarOpen, s.drawerOpen, s.layoutNarrow])

  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const run = (cmd: Command | undefined): void => {
    if (!cmd) return
    onClose()
    cmd.run()
  }

  let lastGroup = ''

  return (
    <motion.div
      {...motionPresets.modal}
      role="dialog"
      aria-modal="true"
      aria-label="Команды"
      className="flex h-fit max-h-[min(520px,70vh)] w-full max-w-[560px] flex-col overflow-hidden rounded-3xl border border-line bg-elevated shadow-modal"
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setIndex((i) => Math.min(commands.length - 1, i + 1))
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setIndex((i) => Math.max(0, i - 1))
        } else if (e.key === 'Enter') {
          e.preventDefault()
          run(commands[index])
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5">
        <SearchIcon className="h-4 w-4 text-fg-muted" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Найти заметку или команду…"
          aria-label="Поиск команды"
          aria-activedescendant={commands[index] ? `cmd-${commands[index].id}` : undefined}
          aria-controls="command-list"
          className="h-full flex-1 bg-transparent text-md text-fg outline-none"
        />
        <Kbd>Esc</Kbd>
      </div>
      <div ref={listRef} id="command-list" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-2">
        {commands.length === 0 && <p className="px-3 py-6 text-center text-base text-fg-muted">Ничего не найдено</p>}
        {commands.map((cmd, i) => {
          const header = cmd.group !== lastGroup ? cmd.group : null
          lastGroup = cmd.group
          return (
            <div key={cmd.id}>
              {header && <div className="px-3 pb-1 pt-2.5 text-xs font-medium text-fg-muted">{header}</div>}
              <div
                id={`cmd-${cmd.id}`}
                role="option"
                aria-selected={i === index}
                data-index={i}
                onMouseMove={() => i !== index && setIndex(i)}
                onClick={() => run(cmd)}
                className={cn(
                  'flex h-9 cursor-default items-center gap-3 rounded-lg px-3 text-base transition-colors duration-fast',
                  i === index ? 'bg-hover text-fg' : 'text-fg'
                )}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center text-fg-secondary">{cmd.icon}</span>
                <span className="min-w-0 flex-1 truncate">{cmd.label}</span>
                {cmd.hint && <span className="shrink-0 text-xs text-fg-muted">{cmd.hint}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </motion.div>
  )
}
