import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { AnimatePresence } from 'framer-motion'
import type { CardSize } from '@shared/types'
import { SORT_LABELS, type SortOrder } from '@shared/noteList'
import { useAppStore } from '../../store/useAppStore'
import type { LayoutSize } from '../../hooks/useLayout'
import { useVisibleNotes } from '../../hooks/useVisibleNotes'
import { Button, ConfirmDialog, DropdownMenu, IconButton, MenuItem, MenuLabel, MenuSeparator, SegmentedControl, Spinner, cn } from '../../ui'
import { queueProgressText, type OcrQueueState } from '@shared/ocrJob'
import { CloseIcon, DownloadIcon, FolderIcon, GridIcon, ListIcon, PinIcon, PlusIcon, ScanDocIcon, SlidersIcon, SortIcon, StarIcon, TagIcon, TrashIcon } from '../icons'
import NotesGrid from '../NotesGrid'
import Trash from '../Trash'
import NoteEditor from '../NoteEditor'
import EditorFrame from '../editor/EditorFrame'
import { formatAccelerator } from '../HotkeyRecorder'
import { ColorPickerButton } from './ColorPicker'

const TITLES = { all: 'Все заметки', recent: 'Недавние', favorites: 'Избранное', pinned: 'Закреплённые', trash: 'Корзина' } as const
const CARD_SIZES: { value: CardSize; label: string }[] = [
  { value: 'small', label: 'Маленькие' },
  { value: 'medium', label: 'Средние' },
  { value: 'large', label: 'Крупные' }
]

/** Main workspace of the notes section: one toolbar, the collection, and the editor panel. */
export default function NotesWorkspace({ layout }: { layout: LayoutSize }): ReactElement {
  const filter = useAppStore((s) => s.notesFilter)
  const tagFilter = useAppStore((s) => s.tagFilter)
  const trashNotes = useAppStore((s) => s.trashNotes)
  const searchQuery = useAppStore((s) => s.searchQuery)
  const viewMode = useAppStore((s) => s.viewMode)
  const setViewMode = useAppStore((s) => s.setViewMode)
  const createNote = useAppStore((s) => s.createNote)
  const emptyTrash = useAppStore((s) => s.emptyTrash)
  const editorNoteId = useAppStore((s) => s.editorNoteId)
  const documentHotkey = useAppStore((s) => s.settings?.hotkeys.document)
  const sortOrder = useAppStore((s) => s.settings?.sortOrder ?? 'modified')
  const cardSize = useAppStore((s) => s.settings?.cardSize ?? 'medium')
  const compact = useAppStore((s) => s.settings?.compactGrid ?? false)
  const setSortOrder = useAppStore((s) => s.setSortOrder)
  const setCardSize = useAppStore((s) => s.setCardSize)
  const setCompactGrid = useAppStore((s) => s.setCompactGrid)
  const selectedCount = useAppStore((s) => s.selection.selected.length)
  const ocrQueue = useAppStore((s) => s.ocrQueue)
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const workspaceRef = useRef<HTMLDivElement>(null)

  const visible = useVisibleNotes()
  const count = filter === 'trash' ? trashNotes.length : visible.notes.length

  const editorOpen = Boolean(editorNoteId) && filter !== 'trash'
  // Narrow windows: the editor takes over the workspace instead of squeezing the grid.
  const editorCovers = editorOpen && layout === 'narrow'

  // With the editor beside the list there is little room: buttons keep only their icons.
  const compactBar = layout === 'narrow' || editorOpen
  const folderName = useAppStore((s) => s.folders.find((f) => f.id === s.activeFolderId)?.name)
  const heading = searchQuery.trim() ? 'Поиск' : tagFilter ? `#${tagFilter}` : folderName && filter === 'all' ? folderName : TITLES[filter]
  const sortKeys = useMemo(() => Object.keys(SORT_LABELS) as SortOrder[], [])

  return (
    <div ref={workspaceRef} className="relative flex h-full min-w-0">
      <div className={cn('flex min-w-0 flex-1 flex-col', editorCovers && 'invisible')} aria-hidden={editorCovers || undefined}>
        {selectedCount > 0 && filter !== 'trash' ? (
          <SelectionBar orderedIds={visible.notes.map((n) => n.id)} />
        ) : (
          <header className="flex h-14 shrink-0 items-center justify-between gap-4 px-6">
            <div className="flex min-w-0 items-baseline gap-2">
              <h1 className="truncate text-xl font-semibold text-fg">{heading}</h1>
              <span className="tabular text-base text-fg-muted">{count}</span>
              <OcrQueueChip state={ocrQueue} />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {filter === 'trash' ? (
                trashNotes.length > 0 && (
                  <Button variant="danger-ghost" icon={<TrashIcon />} onClick={() => setConfirmEmpty(true)}>
                    Очистить корзину
                  </Button>
                )
              ) : (
                <>
                  <DropdownMenu
                    label="Сортировка"
                    trigger={(p) => (
                      <Button {...p} variant="ghost" size="md" icon={<SortIcon />} title="Сортировка">
                        {compactBar ? null : SORT_LABELS[sortOrder]}
                      </Button>
                    )}
                  >
                    <MenuLabel>Сортировать по</MenuLabel>
                    {sortKeys.map((key) => (
                      <MenuItem key={key} checked={sortOrder === key} onSelect={() => setSortOrder(key)}>
                        {SORT_LABELS[key]}
                      </MenuItem>
                    ))}
                    <MenuSeparator />
                    <p className="px-2 py-1.5 text-xs text-fg-muted">Закреплённые всегда сверху.</p>
                  </DropdownMenu>
                  <SegmentedControl
                    aria-label="Вид"
                    value={viewMode}
                    onChange={setViewMode}
                    options={[
                      { value: 'grid', label: 'Сетка', icon: <GridIcon />, iconOnly: true },
                      { value: 'list', label: 'Список', icon: <ListIcon />, iconOnly: true }
                    ]}
                  />
                  <DropdownMenu label="Вид карточек" trigger={(p) => <IconButton {...p} label="Размер карточек" icon={<SlidersIcon />} />}>
                    <MenuLabel>Размер карточек</MenuLabel>
                    {CARD_SIZES.map((size) => (
                      <MenuItem key={size.value} checked={cardSize === size.value} onSelect={() => setCardSize(size.value)}>
                        {size.label}
                      </MenuItem>
                    ))}
                    <MenuSeparator />
                    <MenuItem checked={compact} keepOpen onSelect={() => setCompactGrid(!compact)}>
                      Компактная сетка
                    </MenuItem>
                  </DropdownMenu>
                  <IconButton
                    label="Документ из скриншота"
                    shortcut={documentHotkey ? formatAccelerator(documentHotkey) : undefined}
                    icon={<ScanDocIcon />}
                    onClick={() => void window.api.app.captureDocument()}
                  />
                  <Button variant="primary" icon={<PlusIcon />} onClick={() => void createNote()} title="Новая заметка (Ctrl+N)">
                    {compactBar ? null : 'Новая заметка'}
                  </Button>
                </>
              )}
            </div>
          </header>
        )}

        {filter === 'trash' ? <Trash /> : <NotesGrid visible={visible} />}
      </div>

      <AnimatePresence>
        {editorOpen && editorNoteId && (
          <EditorFrame key="editor-frame" workspace={workspaceRef} layout={layout}>
            <NoteEditor key={editorNoteId} noteId={editorNoteId} layout={layout} framed />
          </EditorFrame>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={confirmEmpty}
        title="Очистить корзину?"
        description="Все заметки в корзине будут удалены безвозвратно."
        confirmLabel="Очистить"
        danger
        onCancel={() => setConfirmEmpty(false)}
        onConfirm={() => {
          setConfirmEmpty(false)
          void emptyTrash()
        }}
      />
    </div>
  )
}

/** Small quiet indicator of the background OCR queue; the work itself never needs this window. */
function OcrQueueChip({ state }: { state: OcrQueueState }): ReactElement | null {
  if (state.active === 0 && state.failed === 0) return null
  if (state.active === 0) {
    return (
      <button
        type="button"
        onClick={() => void window.api.ocr.retryFailed()}
        className="ml-2 inline-flex h-6 items-center gap-1.5 rounded-md bg-warning-soft px-2 text-xs font-medium text-fg hover:bg-hover"
        title="Повторить распознавание фрагментов, которые не удалось прочитать"
      >
        Не распознано: {state.failed} · Повторить
      </button>
    )
  }
  return (
    <span role="status" className="ml-2 inline-flex h-6 items-center gap-1.5 rounded-md bg-accent-soft px-2 text-xs font-medium text-fg">
      <Spinner className="h-3 w-3" />
      {queueProgressText(state)}
      {state.queued > 0 ? ` · в очереди: ${state.queued}` : ''}
    </span>
  )
}

/** Replaces the toolbar while notes are selected: the actions that make sense for many notes at once. */
function SelectionBar({ orderedIds }: { orderedIds: string[] }): ReactElement {
  const selected = useAppStore((s) => s.selection.selected)
  const notes = useAppStore((s) => s.notes)
  const clearSelection = useAppStore((s) => s.clearSelection)
  const selectAll = useAppStore((s) => s.selectAll)
  const bulkPin = useAppStore((s) => s.bulkPin)
  const bulkFavorite = useAppStore((s) => s.bulkFavorite)
  const bulkColor = useAppStore((s) => s.bulkColor)
  const bulkDelete = useAppStore((s) => s.bulkDelete)
  const bulkExport = useAppStore((s) => s.bulkExport)
  const openTagEditor = useAppStore((s) => s.openTagEditor)
  const openFolderDialog = useAppStore((s) => s.openFolderDialog)

  const chosen = useMemo(() => {
    const ids = new Set(selected)
    return notes.filter((n) => ids.has(n.id))
  }, [notes, selected])
  const allPinned = chosen.length > 0 && chosen.every((n) => n.pinned)
  const allFavorite = chosen.length > 0 && chosen.every((n) => n.favorite)

  // Esc clears the selection (when focus is not in a text field / editor that uses Esc itself).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[aria-modal="true"]')) return
      e.preventDefault()
      clearSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clearSelection])

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 bg-accent-soft px-4" role="toolbar" aria-label="Действия с выбранными заметками">
      <div className="flex min-w-0 items-center gap-2">
        <IconButton label="Снять выбор" shortcut="Esc" icon={<CloseIcon />} onClick={clearSelection} />
        <span className="truncate text-base font-medium text-fg">Выбрано: {selected.length}</span>
        {selected.length < orderedIds.length && (
          <Button variant="ghost" size="sm" onClick={() => selectAll(orderedIds)}>
            Выбрать все
          </Button>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton label={allPinned ? 'Открепить' : 'Закрепить'} icon={<PinIcon filled={allPinned} />} active={allPinned} onClick={() => void bulkPin(selected, !allPinned)} />
        <IconButton
          label={allFavorite ? 'Убрать из избранного' : 'В избранное'}
          icon={<StarIcon filled={allFavorite} />}
          active={allFavorite}
          onClick={() => void bulkFavorite(selected, !allFavorite)}
        />
        <ColorPickerButton onPick={(c) => void bulkColor(selected, c)} label="Цвет выбранных заметок" />
        <IconButton label="В папку" icon={<FolderIcon />} onClick={() => openFolderDialog({ type: 'move', ids: selected })} />
        <IconButton label="Добавить теги" icon={<TagIcon />} onClick={() => openTagEditor(selected)} />
        <IconButton label="Экспорт выбранных" icon={<DownloadIcon />} onClick={() => void bulkExport(selected)} />
        <IconButton label="В корзину" tone="danger" icon={<TrashIcon />} onClick={() => void bulkDelete(selected)} />
      </div>
    </header>
  )
}
