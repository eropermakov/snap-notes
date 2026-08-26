import { useMemo, useState, type ReactElement } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Note } from '@shared/types'
import { htmlToPlainText } from '@shared/htmlText'
import { useAppStore } from '../store/useAppStore'
import { PinIcon, TrashIcon } from './icons'
import ConfirmModal from './ConfirmModal'

interface Props {
  note: Note
  listMode?: boolean
}

export default function NoteCard({ note, listMode }: Props): ReactElement {
  const openNote = useAppStore((s) => s.openNote)
  const togglePin = useAppStore((s) => s.togglePin)
  const deleteNote = useAppStore((s) => s.deleteNote)
  const isProcessing = useAppStore((s) => s.processingIds.includes(note.id))
  const [confirmOpen, setConfirmOpen] = useState(false)

  const preview = useMemo(() => htmlToPlainText(note.body), [note.body])

  return (
    <>
      <motion.div
        onClick={() => openNote(note.id)}
        whileHover={{ y: -3 }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        className={`group relative cursor-pointer overflow-hidden rounded-2xl border border-surface-border bg-surface p-4 shadow-card transition-shadow hover:shadow-card-hover ${
          listMode ? 'w-full' : ''
        }`}
      >
        {(note.emoji || note.title) && (
          <h3 className="mb-1.5 line-clamp-2 font-semibold text-ink">
            {note.emoji && <span className="mr-1.5">{note.emoji}</span>}
            {note.title}
          </h3>
        )}

        <AnimatePresence mode="wait" initial={false}>
          {isProcessing ? (
            <motion.div key="shimmer" exit={{ opacity: 0 }} className="space-y-2">
              <div className="h-3 w-full animate-shimmer rounded shimmer-bg" />
              <div className="h-3 w-4/5 animate-shimmer rounded shimmer-bg" />
              <div className="h-3 w-3/5 animate-shimmer rounded shimmer-bg" />
            </motion.div>
          ) : preview ? (
            <motion.p
              key="text"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.35 }}
              className="line-clamp-5 whitespace-pre-wrap text-sm text-ink/80"
            >
              {preview}
            </motion.p>
          ) : !note.title ? (
            <motion.p key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm italic text-muted">
              Пустая заметка
            </motion.p>
          ) : null}
        </AnimatePresence>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 rounded-b-2xl bg-gradient-to-t from-surface via-surface/90 to-transparent p-2 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation()
              void togglePin(note.id)
            }}
            title={note.pinned ? 'Открепить' : 'Закрепить'}
            className={`rounded-full p-2 transition hover:bg-accent-light active:scale-[0.97] ${
              note.pinned ? 'text-accent' : 'text-muted'
            }`}
          >
            <PinIcon className="h-4 w-4" filled={note.pinned} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setConfirmOpen(true)
            }}
            title="Удалить"
            className="rounded-full p-2 text-muted transition hover:bg-danger-light hover:text-danger active:scale-[0.97]"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      </motion.div>

      <ConfirmModal
        open={confirmOpen}
        title="Удалить заметку?"
        description="Это действие нельзя отменить."
        confirmLabel="Удалить"
        danger
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false)
          void deleteNote(note.id)
        }}
      />
    </>
  )
}
