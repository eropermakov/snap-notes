import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { motion } from 'framer-motion'
import { htmlToPlainText } from '@shared/htmlText'
import { useAppStore } from '../store/useAppStore'
import RichTextEditor from './RichTextEditor'
import EmojiPicker from './EmojiPicker'
import { CloseIcon, PinIcon, TrashIcon, CheckIcon } from './icons'
import ConfirmModal from './ConfirmModal'

interface Props {
  noteId: string
}

type SaveState = 'idle' | 'saving' | 'saved'

export default function NoteEditor({ noteId }: Props): ReactElement | null {
  const note = useAppStore((s) => s.notes.find((n) => n.id === noteId))
  const closeEditor = useAppStore((s) => s.closeEditor)
  const updateNote = useAppStore((s) => s.updateNote)
  const togglePin = useAppStore((s) => s.togglePin)
  const deleteNote = useAppStore((s) => s.deleteNote)
  const isProcessing = useAppStore((s) => s.processingIds.includes(noteId))

  const [title, setTitle] = useState(note?.title ?? '')
  const [body, setBody] = useState(note?.body ?? '')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [justUpdated, setJustUpdated] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastSynced = useRef({ title: note?.title ?? '', body: note?.body ?? '' })
  const wasProcessing = useRef(isProcessing)

  useEffect(() => {
    if (!note) return
    const serverBody = note.body
    if (serverBody === lastSynced.current.body) return
    if (serverBody.startsWith(lastSynced.current.body)) {
      const addition = serverBody.slice(lastSynced.current.body.length)
      setBody((current) => current + addition)
    } else if (body === lastSynced.current.body) {
      setBody(serverBody)
    }
    lastSynced.current.body = serverBody
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.body])

  useEffect(() => {
    if (wasProcessing.current && !isProcessing) {
      setJustUpdated(true)
      const t = setTimeout(() => setJustUpdated(false), 1200)
      return () => clearTimeout(t)
    }
    wasProcessing.current = isProcessing
    return undefined
  }, [isProcessing])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const scheduleSave = useCallback(
    (nextTitle: string, nextBody: string) => {
      setSaveState('saving')
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        void updateNote(noteId, { title: nextTitle, body: nextBody }).then(() => {
          lastSynced.current = { title: nextTitle, body: nextBody }
          setSaveState('saved')
          setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 1800)
        })
      }, 500)
    },
    [noteId, updateNote]
  )

  if (!note) return null

  const handleTitleChange = (value: string): void => {
    setTitle(value)
    scheduleSave(value, body)
  }
  const handleBodyChange = (value: string): void => {
    setBody(value)
    scheduleSave(title, value)
  }

  const handleClose = (): void => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      if (title !== lastSynced.current.title || body !== lastSynced.current.body) {
        void updateNote(noteId, { title, body })
        lastSynced.current = { title, body }
      }
    }
    closeEditor()
  }

  return (
    <>
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 34 }}
        className="flex h-full w-full max-w-[440px] shrink-0 flex-col border-l border-surface-border bg-surface"
      >
        <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
          <button onClick={handleClose} className="rounded-full p-2 text-muted transition hover:bg-bg active:scale-[0.97]" title="Закрыть">
            <CloseIcon className="h-4 w-4" />
          </button>

          <div className="flex items-center gap-2">
            <SaveIndicator state={saveState} />
            <button
              onClick={() => void togglePin(noteId)}
              className={`rounded-full p-2 transition hover:bg-accent-light active:scale-[0.97] ${note.pinned ? 'text-accent' : 'text-muted'}`}
              title={note.pinned ? 'Открепить' : 'Закрепить'}
            >
              <PinIcon className="h-4 w-4" filled={note.pinned} />
            </button>
            <button
              onClick={() => setConfirmOpen(true)}
              className="rounded-full p-2 text-muted transition hover:bg-danger-light hover:text-danger active:scale-[0.97]"
              title="Удалить"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-1 flex-col overflow-y-auto px-4 py-4">
          <div className="mb-3 flex items-center gap-2">
            <EmojiPicker
              emoji={note.emoji}
              contextText={`${title} ${htmlToPlainText(body)}`}
              onSelect={(emoji) => void updateNote(noteId, { emoji })}
            />
            <input
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Заголовок"
              className="w-full rounded-md bg-transparent px-1 -mx-1 text-lg font-semibold text-ink placeholder:text-muted transition-colors focus:bg-bg focus:outline-none"
            />
          </div>

          {isProcessing && (
            <div className="mb-3 space-y-2">
              <div className="h-3 w-full animate-shimmer rounded shimmer-bg" />
              <div className="h-3 w-4/5 animate-shimmer rounded shimmer-bg" />
            </div>
          )}

          <div
            className={`flex flex-1 flex-col rounded-xl transition-colors duration-700 ${
              justUpdated ? 'bg-accent-light/60' : 'bg-transparent'
            }`}
          >
            <RichTextEditor html={body} onChange={handleBodyChange} placeholder="Текст заметки..." />
          </div>
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
          void deleteNote(noteId)
        }}
      />
    </>
  )
}

function SaveIndicator({ state }: { state: SaveState }): ReactElement | null {
  if (state === 'idle') return null
  return (
    <span className="flex items-center gap-1 text-xs text-muted">
      {state === 'saving' ? (
        <>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          Сохраняю...
        </>
      ) : (
        <>
          <CheckIcon className="h-3.5 w-3.5 text-success" />
          Сохранено
        </>
      )}
    </span>
  )
}
