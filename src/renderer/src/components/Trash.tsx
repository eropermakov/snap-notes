import { useMemo, useState, type ReactElement } from 'react'
import type { Note } from '@shared/types'
import { htmlToPlainText } from '@shared/htmlText'
import { useAppStore } from '../store/useAppStore'
import ConfirmModal from './ConfirmModal'
import { ChevronLeftIcon, RestoreIcon, TrashIcon } from './icons'

export default function Trash(): ReactElement {
  const trashNotes = useAppStore((s) => s.trashNotes)
  const backToNotes = useAppStore((s) => s.backToNotes)
  const restoreNote = useAppStore((s) => s.restoreNote)
  const permanentDelete = useAppStore((s) => s.permanentDelete)
  const emptyTrash = useAppStore((s) => s.emptyTrash)
  const [emptyConfirmOpen, setEmptyConfirmOpen] = useState(false)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={backToNotes} className="rounded-full p-2 text-muted hover:bg-surface" title="Назад">
              <ChevronLeftIcon className="h-5 w-5" />
            </button>
            <h1 className="text-xl font-semibold text-ink">Корзина</h1>
          </div>
          {trashNotes.length > 0 && (
            <button
              onClick={() => setEmptyConfirmOpen(true)}
              className="rounded-lg border border-danger/40 bg-surface px-3.5 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger-light"
            >
              Очистить корзину
            </button>
          )}
        </div>

        {trashNotes.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-surface-border p-8 text-center text-sm text-muted">
            Корзина пуста
          </p>
        ) : (
          <div className="space-y-2">
            {trashNotes.map((note) => (
              <TrashRow key={note.id} note={note} onRestore={() => void restoreNote(note.id)} onDelete={() => void permanentDelete(note.id)} />
            ))}
          </div>
        )}
      </div>

      <ConfirmModal
        open={emptyConfirmOpen}
        title="Очистить корзину?"
        description="Все заметки в корзине будут удалены безвозвратно."
        confirmLabel="Очистить"
        danger
        onCancel={() => setEmptyConfirmOpen(false)}
        onConfirm={() => {
          setEmptyConfirmOpen(false)
          void emptyTrash()
        }}
      />
    </div>
  )
}

function TrashRow({ note, onRestore, onDelete }: { note: Note; onRestore: () => void; onDelete: () => void }): ReactElement {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const preview = useMemo(() => htmlToPlainText(note.body).slice(0, 140), [note.body])
  const deletedDate = note.deletedAt ? new Date(note.deletedAt).toLocaleDateString('ru-RU') : ''

  return (
    <>
      <div className="flex items-start justify-between gap-3 rounded-xl border border-surface-border bg-surface p-3.5">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink">
            {note.emoji ? `${note.emoji} ` : ''}
            {note.title || 'Без названия'}
          </p>
          {preview && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{preview}</p>}
          <p className="mt-1 text-xs text-muted">Удалено {deletedDate}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button onClick={onRestore} className="rounded-full p-2 text-muted transition-colors hover:bg-accent-light hover:text-accent" title="Восстановить">
            <RestoreIcon className="h-4 w-4" />
          </button>
          <button onClick={() => setConfirmOpen(true)} className="rounded-full p-2 text-muted transition-colors hover:bg-danger-light hover:text-danger" title="Удалить навсегда">
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Удалить навсегда?"
        description="Заметку нельзя будет восстановить."
        confirmLabel="Удалить"
        danger
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false)
          onDelete()
        }}
      />
    </>
  )
}
