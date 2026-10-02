import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { motion } from 'framer-motion'
import { htmlToPlainText } from '@shared/htmlText'
import { Autosaver, type SaveState } from '@shared/autosave'
import { formatStats, noteStats, ocrProviderSummary } from '@shared/noteStats'
import { useAppStore } from '../store/useAppStore'
import type { LayoutSize } from '../hooks/useLayout'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { cn, DropdownMenu, EASE_OUT, IconButton, Spinner } from '../ui'
import RichTextEditor from './RichTextEditor'
import EmojiPicker from './EmojiPicker'
import NoteMenuItems from './notes/NoteMenuItems'
import { ColorPickerButton } from './notes/ColorPicker'
import { AlwaysOnTopIcon, AlertTriangleIcon, CheckIcon, CloseIcon, CopyIcon, MoreIcon, PinIcon, StarIcon, TagIcon } from './icons'
import { formatNoteDate } from '../utils/format'
import { registerFlush } from '../utils/flushRegistry'

interface Props {
  noteId: string
  layout: LayoutSize
  /** Floating note window: closing closes the window, and the window can stay on top. */
  embedded?: boolean
}

const PANEL_WIDTH: Record<LayoutSize, number> = { narrow: 0, normal: 440, wide: 520 }
/** Quiet time after the last keystroke before the note is written (not on every change). */
const AUTOSAVE_DELAY_MS = 1000

interface Draft {
  title: string
  body: string
}

export default function NoteEditor({ noteId, layout, embedded }: Props): ReactElement | null {
  const note = useAppStore((s) => s.notes.find((n) => n.id === noteId))
  const closeEditor = useAppStore((s) => s.closeEditor)
  const updateNote = useAppStore((s) => s.updateNote)
  const togglePin = useAppStore((s) => s.togglePin)
  const toggleFavorite = useAppStore((s) => s.toggleFavorite)
  const setColor = useAppStore((s) => s.setColor)
  const openTagEditor = useAppStore((s) => s.openTagEditor)
  const pushToast = useAppStore((s) => s.pushToast)
  const isProcessing = useAppStore((s) => s.processingIds.includes(noteId))
  const revision = useAppStore((s) => s.noteRevisions[noteId] ?? 0)
  const highlightQuery = useAppStore((s) => s.highlightQuery)
  const fontFamily = useAppStore((s) => s.settings?.editorFontFamily ?? '')
  const fontSize = useAppStore((s) => s.settings?.editorFontSize ?? 14)

  const [title, setTitle] = useState(note?.title ?? '')
  const [body, setBody] = useState(note?.body ?? '')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [justUpdated, setJustUpdated] = useState(false)
  const [onTop, setOnTop] = useState(false)

  const lastSynced = useRef({ title: note?.title ?? '', body: note?.body ?? '' })
  const titleRef = useRef(title)
  const bodyRef = useRef(body)
  titleRef.current = title
  bodyRef.current = body
  const wasProcessing = useRef(isProcessing)
  /** The note as the main process last reported it (sanitized HTML may differ from the editor's). */
  const lastServer = useRef({ title: note?.title ?? '', body: note?.body ?? '' })
  const seenRevision = useRef(revision)

  // One debounced writer per open note: ~1 s after the last change; flushed on close / switch / quit.
  const saverRef = useRef<Autosaver<Draft> | null>(null)
  if (!saverRef.current) {
    saverRef.current = new Autosaver<Draft>({
      delay: AUTOSAVE_DELAY_MS,
      onState: setSaveState,
      save: async (draft) => {
        const saved = await updateNote(noteId, draft)
        lastSynced.current = draft
        if (saved) lastServer.current = { title: saved.title, body: saved.body }
      }
    })
  }
  const saver = saverRef.current

  // Changes made outside the editor (capture appended, undo, AI action, generated title, another window)
  // arrive as a new revision. Echoes of the editor's own saves do not, so they are never merged twice.
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
        saver.schedule({ title: titleRef.current, body: merged })
      } else {
        // No local edits (or a rewrite, which is always preceded by a flush): the server wins.
        saver.cancel()
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

  // Switching notes, closing and quitting never lose a pending edit.
  useEffect(() => {
    const unregister = registerFlush(() => saver.flush())
    return () => {
      unregister()
      void saver.flush()
    }
  }, [saver])

  useEffect(() => {
    if (!embedded) return
    void window.api.window.getState().then((s) => setOnTop(s.alwaysOnTop))
  }, [embedded])

  /** Saves pending edits right away (before the main process rewrites this note). */
  const flush = useCallback(async (): Promise<void> => {
    await saver.flush()
  }, [saver])

  // Words / characters are recounted only after typing pauses (cheap even for long notes).
  const settledBody = useDebouncedValue(body, 300)
  const stats = useMemo(() => noteStats(deferredBody(settledBody)), [settledBody])

  if (!note) return null

  const handleTitleChange = (value: string): void => {
    setTitle(value)
    saver.schedule({ title: value, body })
  }
  const handleBodyChange = (value: string): void => {
    setBody(value)
    saver.schedule({ title, body: value })
  }

  const handleClose = (): void => {
    void saver.flush()
    if (embedded) window.api.window.close()
    else closeEditor()
  }

  /** "Copy all": the whole note, formatted for Word / mail, with a plain-text twin — no internal data. */
  const copyAll = async (): Promise<void> => {
    await saver.flush()
    const result = await window.api.notes.copy(noteId, 'rich')
    pushToast(result.ok ? 'success' : 'error', result.ok ? 'Вся заметка скопирована' : 'Не удалось скопировать заметку')
  }

  const toggleOnTop = async (): Promise<void> => {
    setOnTop(await window.api.window.setAlwaysOnTop(!onTop))
  }

  const covers = layout === 'narrow'
  const provider = ocrProviderSummary(note.sources)

  return (
    <motion.section
      aria-label="Редактор заметки"
      initial={embedded ? false : { opacity: 0, x: 24 }}
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
      <div className={cn('flex h-14 shrink-0 items-center justify-between gap-2 px-3', embedded && 'drag-region')}>
        <div className="no-drag flex items-center gap-1">
          <IconButton label={embedded ? 'Закрыть окно' : 'Закрыть'} shortcut="Esc" icon={<CloseIcon />} onClick={handleClose} />
          {isProcessing && (
            <span className="flex items-center gap-1.5 pl-1 text-xs text-fg-muted">
              <Spinner className="h-3 w-3" /> Распознаю…
            </span>
          )}
        </div>
        <div className="no-drag flex items-center gap-0.5">
          {embedded && (
            <IconButton
              label={onTop ? 'Не держать поверх окон' : 'Поверх всех окон'}
              icon={<AlwaysOnTopIcon filled={onTop} />}
              active={onTop}
              onClick={() => void toggleOnTop()}
            />
          )}
          <IconButton
            label={note.favorite ? 'Убрать из избранного' : 'В избранное'}
            icon={<StarIcon filled={note.favorite} />}
            active={note.favorite}
            onClick={() => void toggleFavorite(noteId)}
          />
          <IconButton
            label={note.pinned ? 'Открепить' : 'Закрепить'}
            icon={<PinIcon filled={note.pinned} />}
            active={note.pinned}
            onClick={() => void togglePin(noteId)}
          />
          <ColorPickerButton value={note.color} onPick={(c) => void setColor(noteId, c)} />
          <IconButton label="Копировать всё" icon={<CopyIcon />} onClick={() => void copyAll()} />
          <DropdownMenu label="Действия с заметкой" trigger={(p) => <IconButton {...p} label="Ещё" icon={<MoreIcon />} />}>
            <NoteMenuItems note={note} showOpen={false} showFloating={!embedded} />
          </DropdownMenu>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className={cn('mx-auto flex w-full flex-1 flex-col px-6 pb-6 pt-2', covers && 'max-w-[760px]')}>
          <div className="mb-1 flex items-center gap-2">
            <EmojiPicker emoji={note.emoji} contextText={`${title} ${htmlToPlainText(body)}`} onSelect={(emoji) => void updateNote(noteId, { emoji })} />
            <input
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Заголовок"
              aria-label="Заголовок"
              className="w-full min-w-0 bg-transparent text-2xl font-semibold tracking-[-0.01em] text-fg outline-none placeholder:text-fg-muted"
            />
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-1.5" aria-label="Теги">
            {note.tags.map((tag) => (
              <button key={tag} type="button" className="tag-chip hover:bg-active" onClick={() => openTagEditor([noteId])} title="Изменить теги">
                #{tag}
              </button>
            ))}
            <button
              type="button"
              onClick={() => openTagEditor([noteId])}
              className="inline-flex h-[22px] items-center gap-1 rounded-md px-1.5 text-xs text-fg-muted hover:bg-hover hover:text-fg"
            >
              <TagIcon className="h-3 w-3" />
              {note.tags.length === 0 ? 'Добавить тег' : ''}
            </button>
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
              highlightQuery={highlightQuery}
              fontFamily={fontFamily}
              fontSize={fontSize}
            />
          </div>
        </div>
      </div>

      <StatusBar
        saveState={saveState}
        updatedAt={note.updatedAt}
        stats={formatStats(stats)}
        provider={provider.mixed ? 'OCR: разные источники' : provider.label ? `OCR: ${provider.label}` : null}
        onRetry={() => void saver.flush()}
      />
    </motion.section>
  )
}

/** Statistics are computed from at most the first 400k characters, so huge notes stay cheap. */
function deferredBody(body: string): string {
  return body.length > 400_000 ? body.slice(0, 400_000) : body
}

function StatusBar({
  saveState,
  updatedAt,
  stats,
  provider,
  onRetry
}: {
  saveState: SaveState
  updatedAt: number
  stats: string
  provider: string | null
  onRetry: () => void
}): ReactElement {
  let status: ReactElement
  if (saveState === 'saving') {
    status = <span>Сохраняю…</span>
  } else if (saveState === 'error') {
    status = (
      <span className="flex items-center gap-1 text-danger">
        <AlertTriangleIcon className="h-3.5 w-3.5" /> Ошибка сохранения
        <button type="button" onClick={onRetry} className="ml-1 rounded px-1 underline hover:bg-hover">
          Повторить
        </button>
      </span>
    )
  } else {
    status = (
      <span className="flex items-center gap-1" title={`Изменено ${formatNoteDate(updatedAt)}`}>
        <CheckIcon className="h-3.5 w-3.5 text-success" /> Сохранено
      </span>
    )
  }
  return (
    <div role="status" aria-live="polite" className="flex h-8 shrink-0 items-center gap-2 border-t border-line px-4 text-xs text-fg-muted">
      {status}
      <span aria-hidden>·</span>
      <span className="tabular">{stats}</span>
      {provider && (
        <>
          <span aria-hidden>·</span>
          <span className="truncate">{provider}</span>
        </>
      )}
    </div>
  )
}
