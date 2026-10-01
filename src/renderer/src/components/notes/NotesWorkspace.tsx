import { useMemo, useState, type ReactElement } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useAppStore } from '../../store/useAppStore'
import type { LayoutSize } from '../../hooks/useLayout'
import { Button, ConfirmDialog, IconButton, SegmentedControl, cn } from '../../ui'
import { GridIcon, ListIcon, PlusIcon, ScanDocIcon, TrashIcon } from '../icons'
import NotesGrid from '../NotesGrid'
import Trash from '../Trash'
import NoteEditor from '../NoteEditor'
import { matchesQuery } from './noteFilters'
import { formatAccelerator } from '../HotkeyRecorder'

const TITLES = { all: 'Все заметки', pinned: 'Закреплённые', trash: 'Корзина' } as const

/** Main workspace of the notes section: one toolbar, the collection, and the editor panel. */
export default function NotesWorkspace({ layout }: { layout: LayoutSize }): ReactElement {
  const filter = useAppStore((s) => s.notesFilter)
  const notes = useAppStore((s) => s.notes)
  const trashNotes = useAppStore((s) => s.trashNotes)
  const searchQuery = useAppStore((s) => s.searchQuery)
  const viewMode = useAppStore((s) => s.viewMode)
  const setViewMode = useAppStore((s) => s.setViewMode)
  const createNote = useAppStore((s) => s.createNote)
  const emptyTrash = useAppStore((s) => s.emptyTrash)
  const editorNoteId = useAppStore((s) => s.editorNoteId)
  const documentHotkey = useAppStore((s) => s.settings?.hotkeys.document)
  const [confirmEmpty, setConfirmEmpty] = useState(false)

  const count = useMemo(() => {
    if (filter === 'trash') return trashNotes.filter((n) => matchesQuery(n, searchQuery)).length
    return notes.filter((n) => matchesQuery(n, searchQuery) && (filter !== 'pinned' || n.pinned)).length
  }, [filter, notes, trashNotes, searchQuery])

  const editorOpen = Boolean(editorNoteId) && filter !== 'trash'
  // Narrow windows: the editor takes over the workspace instead of squeezing the grid.
  const editorCovers = editorOpen && layout === 'narrow'

  return (
    <div className="relative flex h-full min-w-0">
      <div className={cn('flex min-w-0 flex-1 flex-col', editorCovers && 'invisible')} aria-hidden={editorCovers || undefined}>
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 px-6">
          <div className="flex min-w-0 items-baseline gap-2">
            <h1 className="truncate text-xl font-semibold text-fg">{searchQuery.trim() ? 'Поиск' : TITLES[filter]}</h1>
            <span className="tabular text-base text-fg-muted">{count}</span>
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
                <SegmentedControl
                  aria-label="Вид"
                  value={viewMode}
                  onChange={setViewMode}
                  options={[
                    { value: 'grid', label: 'Сетка', icon: <GridIcon />, iconOnly: true },
                    { value: 'list', label: 'Список', icon: <ListIcon />, iconOnly: true }
                  ]}
                />
                <IconButton
                  label="Документ из скриншота"
                  shortcut={documentHotkey ? formatAccelerator(documentHotkey) : undefined}
                  icon={<ScanDocIcon />}
                  onClick={() => void window.api.app.captureDocument()}
                />
                <Button variant="primary" icon={<PlusIcon />} onClick={() => void createNote()} title="Новая заметка (Ctrl+N)">
                  {layout === 'narrow' && editorOpen ? null : 'Новая заметка'}
                </Button>
              </>
            )}
          </div>
        </header>

        {filter === 'trash' ? <Trash /> : <NotesGrid />}
      </div>

      <AnimatePresence>
        {editorOpen && editorNoteId && <NoteEditor key={editorNoteId} noteId={editorNoteId} layout={layout} />}
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
