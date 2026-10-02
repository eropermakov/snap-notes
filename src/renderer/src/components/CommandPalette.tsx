import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { SORT_LABELS, recentNotes, type SortOrder } from '@shared/noteList'
import { useAppStore } from '../store/useAppStore'
import { searchAllNotes } from '../hooks/useVisibleNotes'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { cn, Kbd, motionPresets } from '../ui'
import {
  ClipboardIcon,
  ClockIcon,
  DownloadIcon,
  GearIcon,
  GridIcon,
  ImageIcon,
  InboxIcon,
  ListIcon,
  NotesIcon,
  PanelLeftIcon,
  PinIcon,
  PlusIcon,
  QuestionIcon,
  RefreshIcon,
  RepeatIcon,
  ScanDocIcon,
  SearchIcon,
  SortIcon,
  FolderIcon,
  StarIcon,
  TrashIcon,
  UndoIcon
} from './icons'
import { SETTINGS_CATEGORIES } from './Settings'
import { noteLabel } from './notes/noteFilters'
import { Highlight } from './notes/Highlight'
import { fileToPngBytes } from '../utils/imageFiles'

interface Command {
  id: string
  group: string
  /** Plain text used for filtering and the accessible name. */
  label: string
  /** Rich rendering of the label (highlighted match). */
  node?: ReactNode
  /** Second line: the fragment of the note that matched. */
  detail?: ReactNode
  icon: ReactNode
  hint?: string
  keywords?: string
  run: () => void
}

const SEARCH_DEBOUNCE = 150

/** Ctrl+K: every action and every note, one keyboard-driven list (↑ ↓ Enter Esc). */
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
  // The search itself waits for a short pause in typing; the field stays instantly responsive.
  const debounced = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    inputRef.current?.focus()
    return () => previous?.focus?.()
  }, [])

  const ocrFile = async (): Promise<void> => {
    const picked = await window.api.notes.pickImage()
    if (!picked) return
    if (picked.error || !picked.bytes) {
      s.pushToast('error', picked.error ?? 'Не удалось открыть файл')
      return
    }
    try {
      const png = await fileToPngBytes(new Blob([picked.bytes as BlobPart]))
      await window.api.notes.ocrImageData(s.editorNoteId, png)
    } catch (err) {
      s.pushToast('error', (err as Error).message)
    }
  }

  const commands = useMemo<Command[]>(() => {
    const sorts = (Object.keys(SORT_LABELS) as SortOrder[]).map<Command>((key) => ({
      id: `sort-${key}`,
      group: 'Сортировка',
      label: `Сортировать: ${SORT_LABELS[key]}`,
      icon: <SortIcon />,
      keywords: 'порядок sort',
      run: () => s.setSortOrder(key)
    }))
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
      {
        id: 'repeat',
        group: 'Действия',
        label: 'Повторить последний захват',
        icon: <RepeatIcon />,
        keywords: 'область снова screenshot repeat',
        run: () => void window.api.capture.repeat()
      },
      {
        id: 'clipboard-ocr',
        group: 'Действия',
        label: 'Распознать картинку из буфера обмена',
        icon: <ClipboardIcon />,
        keywords: 'ocr clipboard буфер',
        run: () =>
          void window.api.capture.ocrClipboard().then((r) => {
            if (!r.ok) s.pushToast('warning', r.message ?? 'В буфере обмена нет изображения')
          })
      },
      { id: 'file-ocr', group: 'Действия', label: 'Распознать текст с картинки из файла…', icon: <ImageIcon />, keywords: 'ocr файл png jpg', run: () => void ocrFile() },
      {
        id: 'undo-ocr',
        group: 'Действия',
        label: 'Отменить последнее распознавание',
        icon: <UndoIcon />,
        keywords: 'undo ocr',
        run: () =>
          void window.api.capture.undoLast().then((r) => {
            if (!r.ok) s.pushToast('warning', 'Нечего отменять')
          })
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
        id: 'compact',
        group: 'Действия',
        label: s.settings?.compactGrid ? 'Обычная сетка' : 'Компактная сетка',
        icon: <GridIcon />,
        keywords: 'плотность размер карточек',
        run: () => s.setCompactGrid(!s.settings?.compactGrid)
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
      { id: 'go-all', group: 'Перейти', label: 'Все заметки', icon: <InboxIcon />, run: () => {
          s.setTagFilter(null)
          s.setNotesFilter('all')
        }
      },
      { id: 'go-recent', group: 'Перейти', label: 'Недавние', icon: <ClockIcon />, run: () => s.setNotesFilter('recent') },
      { id: 'go-favorites', group: 'Перейти', label: 'Избранное', icon: <StarIcon />, run: () => s.setNotesFilter('favorites') },
      { id: 'go-pinned', group: 'Перейти', label: 'Закреплённые', icon: <PinIcon />, run: () => s.setNotesFilter('pinned') },
      { id: 'new-folder', group: 'Действия', label: 'Новая папка', icon: <PlusIcon />, keywords: 'folder папка', run: () => s.openFolderDialog({ type: 'create' }) },
      ...s.folders.map<Command>((f) => ({ id: `go-folder-${f.id}`, group: 'Папки', label: `Папка: ${f.name}`, icon: <FolderIcon />, keywords: 'folder папка', run: () => s.setActiveFolder(f.id) })),
      { id: 'go-trash', group: 'Перейти', label: 'Корзина', icon: <TrashIcon />, run: () => s.setNotesFilter('trash') },
      { id: 'go-help', group: 'Перейти', label: 'Справка', icon: <QuestionIcon />, run: s.openInstructions },
      ...sorts,
      ...SETTINGS_CATEGORIES.map((c) => ({
        id: `settings-${c.id}`,
        group: 'Настройки',
        label: `Настройки: ${c.label}`,
        icon: <GearIcon />,
        hint: c.id === 'general' ? 'Ctrl+,' : undefined,
        run: () => s.openSettings(c.id)
      }))
    ]
    const q = debounced.toLowerCase()
    const filteredActions = q ? actions.filter((a) => `${a.label} ${a.keywords ?? ''}`.toLowerCase().includes(q)) : actions

    let noteCommands: Command[]
    if (q) {
      noteCommands = searchAllNotes(s.notes, debounced, 20).map<Command>(({ note, hit }) => ({
        id: `note-${note.id}`,
        group: 'Заметки',
        label: `${note.emoji ? `${note.emoji} ` : ''}${noteLabel(note)}`,
        node: (
          <>
            {note.emoji && <span className="mr-1.5">{note.emoji}</span>}
            {note.title.trim() ? <Highlight text={note.title} ranges={hit.titleRanges} /> : noteLabel(note)}
          </>
        ),
        detail: hit.snippet ? <Highlight text={hit.snippet} ranges={hit.snippetRanges} /> : hit.matchedIn.includes('tags') ? 'Совпадение в тегах' : undefined,
        icon: note.favorite ? <StarIcon filled /> : note.pinned ? <PinIcon filled /> : <NotesIcon />,
        run: () => s.openNote(note.id, debounced)
      }))
    } else {
      noteCommands = recentNotes(s.notes, 5).map<Command>((n) => ({
        id: `note-${n.id}`,
        group: 'Недавние заметки',
        label: `${n.emoji ? `${n.emoji} ` : ''}${noteLabel(n)}`,
        icon: <NotesIcon />,
        run: () => s.openNote(n.id)
      }))
    }
    return q ? [...noteCommands, ...filteredActions] : [...filteredActions.slice(0, 8), ...noteCommands, ...filteredActions.slice(8)]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, s.notes, s.folders, s.viewMode, s.sidebarOpen, s.drawerOpen, s.layoutNarrow, s.settings?.compactGrid, s.editorNoteId])

  // While the user is still typing, the list shows the previous result instead of flickering.
  const pending = query.trim() !== debounced

  useEffect(() => setIndex(0), [debounced])
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
      className="flex h-fit max-h-[min(560px,72vh)] w-full max-w-[580px] flex-col overflow-hidden rounded-3xl border border-line bg-elevated shadow-modal"
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
      <div ref={listRef} id="command-list" role="listbox" className={cn('min-h-0 flex-1 overflow-y-auto p-2', pending && 'opacity-70')}>
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
                aria-label={cmd.label}
                data-index={i}
                onMouseMove={() => i !== index && setIndex(i)}
                onClick={() => run(cmd)}
                className={cn(
                  'flex min-h-9 cursor-default items-center gap-3 rounded-lg px-3 py-1.5 text-base transition-colors duration-fast',
                  i === index ? 'bg-hover text-fg' : 'text-fg'
                )}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center text-fg-secondary">{cmd.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{cmd.node ?? cmd.label}</span>
                  {cmd.detail && <span className="mt-0.5 line-clamp-1 block text-sm text-fg-secondary">{cmd.detail}</span>}
                </span>
                {cmd.hint && <span className="shrink-0 text-xs text-fg-muted">{cmd.hint}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </motion.div>
  )
}
