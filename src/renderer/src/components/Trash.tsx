import { useMemo, useState, type ReactElement } from 'react'
import type { Note } from '@shared/types'
import { useAppStore } from '../store/useAppStore'
import { ConfirmDialog, EmptyState, IconButton, Menu, MenuItem, MenuSeparator, useContextMenu } from '../ui'
import { RestoreIcon, TrashIcon } from './icons'
import { matchesQuery, noteLabel, notePreview } from './notes/noteFilters'
import { formatNoteDate, pluralRu } from '../utils/format'

const DAY = 86_400_000

/** Trash list. "Empty trash" lives in the workspace header (see NotesWorkspace). */
export default function Trash(): ReactElement {
  const trashNotes = useAppStore((s) => s.trashNotes)
  const searchQuery = useAppStore((s) => s.searchQuery)
  const retentionDays = useAppStore((s) => s.settings?.trashRetentionDays ?? 30)

  const visible = useMemo(
    () => trashNotes.filter((n) => matchesQuery(n, searchQuery)).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)),
    [trashNotes, searchQuery]
  )

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[880px] px-6 pb-12">
        {trashNotes.length === 0 ? (
          <EmptyState
            size="sm"
            title="Корзина пуста"
            description={`Удалённые заметки хранятся здесь ${retentionDays} ${pluralRu(retentionDays, 'день', 'дня', 'дней')}, потом удаляются автоматически.`}
          />
        ) : visible.length === 0 ? (
          <EmptyState size="sm" title="Ничего не найдено" description="В корзине нет заметок по этому запросу." />
        ) : (
          <div className="-mx-4 flex flex-col gap-px">
            {visible.map((note) => (
              <TrashRow key={note.id} note={note} retentionDays={retentionDays} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function TrashRow({ note, retentionDays }: { note: Note; retentionDays: number }): ReactElement {
  const restoreNote = useAppStore((s) => s.restoreNote)
  const permanentDelete = useAppStore((s) => s.permanentDelete)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const { onContextMenu, menu } = useContextMenu()
  const preview = useMemo(() => notePreview(note.body).slice(0, 160), [note.body])

  const deletedAt = note.deletedAt ?? Date.now()
  const daysLeft = Math.max(0, retentionDays - Math.floor((Date.now() - deletedAt) / DAY))

  return (
    <>
      <div onContextMenu={onContextMenu} className="group flex items-center gap-4 rounded-xl px-4 py-2.5 transition-colors duration-fast hover:bg-hover focus-within:bg-hover">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-medium text-fg">
            {note.emoji && <span className="mr-1.5">{note.emoji}</span>}
            {noteLabel(note)}
          </p>
          {note.title.trim() && preview && <p className="mt-0.5 truncate text-sm text-fg-secondary">{preview}</p>}
        </div>
        <div className="relative flex shrink-0 items-center">
          <span className="text-xs text-fg-muted transition-opacity duration-fast group-focus-within:opacity-0 group-hover:opacity-0">
            Удалено {formatNoteDate(deletedAt)} · {daysLeft === 0 ? 'удалится сегодня' : `ещё ${daysLeft} ${pluralRu(daysLeft, 'день', 'дня', 'дней')}`}
          </span>
          <div className="absolute right-0 flex items-center gap-0.5 opacity-0 transition-opacity duration-fast group-focus-within:opacity-100 group-hover:opacity-100">
            <IconButton size="sm" label="Восстановить" icon={<RestoreIcon />} onClick={() => void restoreNote(note.id)} />
            <IconButton size="sm" tone="danger" label="Удалить навсегда" icon={<TrashIcon />} onClick={() => setConfirmOpen(true)} />
          </div>
        </div>
      </div>

      <Menu {...menu} aria-label="Действия с заметкой">
        <MenuItem icon={<RestoreIcon />} onSelect={() => void restoreNote(note.id)}>
          Восстановить
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<TrashIcon />} danger onSelect={() => setConfirmOpen(true)}>
          Удалить навсегда
        </MenuItem>
      </Menu>

      <ConfirmDialog
        open={confirmOpen}
        title="Удалить навсегда?"
        description="Заметку нельзя будет восстановить."
        confirmLabel="Удалить"
        danger
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false)
          void permanentDelete(note.id)
        }}
      />
    </>
  )
}
