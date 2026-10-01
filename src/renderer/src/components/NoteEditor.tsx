import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { motion } from 'framer-motion'
import { htmlToPlainText } from '@shared/htmlText'
import { useAppStore } from '../store/useAppStore'
import type { LayoutSize } from '../hooks/useLayout'
import { cn, DropdownMenu, EASE_OUT, IconButton, Spinner } from '../ui'
import RichTextEditor from './RichTextEditor'
import EmojiPicker from './EmojiPicker'
import NoteMenuItems from './notes/NoteMenuItems'
import { CloseIcon, PinIcon, CheckIcon, MoreIcon } from './icons'
import { formatNoteDate } from '../utils/format'

interface Props {
  noteId: string
  layout: LayoutSize
}

type SaveState = 'idle' | 'saving' | 'saved'

const PANEL_WIDTH: Record<LayoutSize, number> = { narrow: 0, normal: 440, wide: 520 }

export default function NoteEditor({ noteId, layout }: Props): ReactElement | null {
  const note = useAppStore((s) => s.notes.find((n) => n.id === noteId))
  const closeEditor = useAppStore((s) => s.closeEditor)
  const updateNote = useAppStore((s) => s.updateNote)
  const togglePin = useAppStore((s) => s.togglePin)
  const isProcessing = useAppStore((s) => s.processingIds.includes(noteId))
  const revision = useAppStore((s) => s.noteRevisions[noteId] ?? 0)

  const [title, setTitle] = useState(note?.title ?? '')
  const [body, setBody] = useState(note?.body ?? '')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [justUpdated, setJustUpdated] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastSynced = useRef({ title: note?.title ?? '', body: note?.body ?? '' })
  const titleRef = useRef(title)
  const bodyRef = useRef(body)
  titleRef.current = title
  bodyRef.current = body
  const wasProcessing = useRef(isProcessing)
  /** The note as the main process last reported it (sanitized HTML may differ from the editor's). */
  const lastServer = useRef({ title: note?.title ?? '', body: note?.body ?? '' })
  const seenRevision = useRef(revision)

  // Changes made outside the editor (capture appended, undo, AI action, generated title) arrive as a
  // new revision. Echoes of the editor's own saves do not, so they can never be merged back in twice.
  useEffect(() => {
    if (!note || revision === seenRevision.current) return
    seenRevision.current = revision

    if (note.title !== lastServer.current.title) {
      // Take the new title unless the user has typed an unsaved one.
      if (titleRef.current === lastSynced.current.title) {
        setTitle(note.title)
        lastSynced.current.title = note.title
      }
      lastServer.current.title = note.title
    }

    if (note.body !== lastServer.current.body) {
      const local = bodyRef.current
      const unsaved = local !== lastSynced.current.body
      if (unsaved && note.body.startsWith(lastServer.current.body)) {
        // Appended while the user was typing: keep the typing and add the new content.
        const merged = local + note.body.slice(lastServer.current.body.length)
        setBody(merged)
        scheduleSave(titleRef.current, merged)
      } else {
        // No local edits (or a rewrite, which is always preceded by a flush): the server wins.
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = undefined
        setBody(note.body)
        lastSynced.current.body = note.body
      }
      lastServer.current.body = note.body
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision])

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
        debounceRef.current = undefined
        void updateNote(noteId, { title: nextTitle, body: nextBody }).then((saved) => {
          lastSynced.current = { title: nextTitle, body: nextBody }
          if (saved) lastServer.current = { title: saved.title, body: saved.body }
          setSaveState('saved')
          setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 1800)
        })
      }, 500)
    },
    [noteId, updateNote]
  )

  /** Saves pending edits right away (before the main process rewrites this note). */
  const flush = useCallback(async (): Promise<void> => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = undefined
    const current = { title: titleRef.current, body: bodyRef.current }
    if (current.title === lastSynced.current.title && current.body === lastSynced.current.body) return
    const saved = await updateNote(noteId, current)
    lastSynced.current = current
    if (saved) lastServer.current = { title: saved.title, body: saved.body }
    setSaveState('idle')
  }, [noteId, updateNote])

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

  const covers = layout === 'narrow'

  return (
    <motion.section
      aria-label="Редактор заметки"
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.2, ease: EASE_OUT }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault()
          handleClose()
        }
      }}
      style={covers ? undefined : { width: PANEL_WIDTH[layout] }}
      className={cn('flex h-full shrink-0 flex-col bg-canvas', covers ? 'absolute inset-0 z-20' : 'border-l border-line')}
    >
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-3">
        <div className="flex items-center gap-1">
          <IconButton label="Закрыть" shortcut="Esc" icon={<CloseIcon />} onClick={handleClose} />
          <span className="pl-1 text-xs text-fg-muted">
            <SaveIndicator state={saveState} updatedAt={note.updatedAt} processing={isProcessing} />
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton
            label={note.pinned ? 'Открепить' : 'Закрепить'}
            icon={<PinIcon filled={note.pinned} />}
            active={note.pinned}
            onClick={() => void togglePin(noteId)}
          />
          <DropdownMenu label="Действия с заметкой" trigger={(p) => <IconButton {...p} label="Ещё" icon={<MoreIcon />} />}>
            <NoteMenuItems note={note} showOpen={false} />
          </DropdownMenu>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className={cn('mx-auto flex w-full flex-1 flex-col px-6 pb-10 pt-2', covers && 'max-w-[760px]')}>
          <div className="mb-2 flex items-center gap-2">
            <EmojiPicker emoji={note.emoji} contextText={`${title} ${htmlToPlainText(body)}`} onSelect={(emoji) => void updateNote(noteId, { emoji })} />
            <input
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Заголовок"
              aria-label="Заголовок"
              className="w-full min-w-0 bg-transparent text-2xl font-semibold tracking-[-0.01em] text-fg outline-none placeholder:text-fg-disabled"
            />
          </div>

          {isProcessing && (
            <div className="mb-3 space-y-2" aria-label="Распознаётся…">
              <div className="h-2.5 w-full animate-shimmer rounded-full shimmer-bg" />
              <div className="h-2.5 w-4/5 animate-shimmer rounded-full shimmer-bg" />
            </div>
          )}

          <div className={cn('-mx-2 flex flex-1 flex-col rounded-xl px-2 transition-colors duration-700', justUpdated ? 'bg-accent-soft' : 'bg-transparent')}>
            <RichTextEditor
              html={body}
              onChange={handleBodyChange}
              placeholder="Начните писать или сделайте скриншот…"
              noteId={noteId}
              sources={note.sources}
              flush={flush}
              externalRevision={revision}
            />
          </div>
        </div>
      </div>
    </motion.section>
  )
}

function SaveIndicator({ state, updatedAt, processing }: { state: SaveState; updatedAt: number; processing: boolean }): ReactElement {
  if (processing) {
    return (
      <span className="flex items-center gap-1.5">
        <Spinner className="h-3 w-3" /> Распознаю…
      </span>
    )
  }
  if (state === 'saving') return <span>Сохраняю…</span>
  if (state === 'saved') {
    return (
      <span className="flex items-center gap-1">
        <CheckIcon className="h-3.5 w-3.5 text-success" /> Сохранено
      </span>
    )
  }
  return <span>Изменено {formatNoteDate(updatedAt)}</span>
}
