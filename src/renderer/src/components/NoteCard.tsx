import { useMemo, type KeyboardEvent, type ReactElement } from 'react'
import type { Note } from '@shared/types'
import { useAppStore } from '../store/useAppStore'
import { cn, DropdownMenu, IconButton, Menu, useContextMenu } from '../ui'
import { MoreIcon, PinIcon } from './icons'
import NoteMenuItems from './notes/NoteMenuItems'
import { noteLabel, notePreview } from './notes/noteFilters'
import { formatNoteDate } from '../utils/format'

interface Props {
  note: Note
  listMode?: boolean
}

/** A note is content first: title + text on a quiet surface; actions appear on hover, focus or right-click. */
export default function NoteCard({ note, listMode }: Props): ReactElement {
  const openNote = useAppStore((s) => s.openNote)
  const togglePin = useAppStore((s) => s.togglePin)
  const selected = useAppStore((s) => s.editorNoteId === note.id)
  const isProcessing = useAppStore((s) => s.processingIds.includes(note.id))
  const { onContextMenu, menu } = useContextMenu()

  const preview = useMemo(() => notePreview(note.body), [note.body])
  const hasTitle = Boolean(note.emoji || note.title.trim())

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openNote(note.id)
    }
  }

  const actions = (
    <div
      className={cn(
        'flex items-center gap-0.5 rounded-lg opacity-0 transition-opacity duration-fast group-focus-within:opacity-100 group-hover:opacity-100 has-[[aria-expanded=true]]:opacity-100',
        listMode ? '' : 'absolute right-2 top-2 bg-[var(--surface-2)] p-0.5'
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <IconButton
        size="sm"
        label={note.pinned ? 'Открепить' : 'Закрепить'}
        icon={<PinIcon filled={note.pinned} />}
        onClick={() => void togglePin(note.id)}
      />
      <DropdownMenu label="Действия с заметкой" trigger={(p) => <IconButton {...p} size="sm" label="Ещё" icon={<MoreIcon />} />}>
        <NoteMenuItems note={note} showOpen={false} />
      </DropdownMenu>
    </div>
  )

  const shimmer = (
    <div className="space-y-2 py-1" aria-label="Распознаётся…">
      <div className="h-2.5 w-full animate-shimmer rounded-full shimmer-bg" />
      <div className="h-2.5 w-4/5 animate-shimmer rounded-full shimmer-bg" />
      <div className="h-2.5 w-3/5 animate-shimmer rounded-full shimmer-bg" />
    </div>
  )

  if (listMode) {
    return (
      <>
        <div
          role="button"
          tabIndex={0}
          aria-label={noteLabel(note)}
          aria-current={selected || undefined}
          onClick={() => openNote(note.id)}
          onKeyDown={onKeyDown}
          onContextMenu={onContextMenu}
          className={cn(
            'group flex cursor-default items-center gap-4 rounded-xl px-4 py-2.5 transition-colors duration-fast',
            selected ? 'bg-surface-selected' : 'hover:bg-hover'
          )}
        >
          <div className="min-w-0 flex-1">
            <p className={cn('truncate text-base', hasTitle ? 'font-medium text-fg' : 'text-fg-secondary')}>
              {note.emoji && <span className="mr-1.5">{note.emoji}</span>}
              {note.title.trim() || (preview ? preview.slice(0, 120) : 'Пустая заметка')}
            </p>
            {isProcessing ? (
              <div className="mt-1.5 h-2 w-2/3 animate-shimmer rounded-full shimmer-bg" />
            ) : (
              note.title.trim() && preview && <p className="mt-0.5 truncate text-sm text-fg-secondary">{preview}</p>
            )}
          </div>
          <div className="relative flex shrink-0 items-center">
            <span className="flex items-center gap-2 text-xs text-fg-muted transition-opacity duration-fast group-focus-within:opacity-0 group-hover:opacity-0 group-has-[[aria-expanded=true]]:opacity-0">
              {note.pinned && <PinIcon filled className="h-3 w-3" />}
              {formatNoteDate(note.updatedAt)}
            </span>
            <div className="absolute right-0">{actions}</div>
          </div>
        </div>
        <Menu {...menu} aria-label="Действия с заметкой">
          <NoteMenuItems note={note} />
        </Menu>
      </>
    )
  }

  return (
    <>
      <article
        role="button"
        tabIndex={0}
        aria-label={noteLabel(note)}
        aria-current={selected || undefined}
        onClick={() => openNote(note.id)}
        onKeyDown={onKeyDown}
        onContextMenu={onContextMenu}
        className={cn(
          'group relative flex cursor-default flex-col rounded-2xl border p-4 transition-colors duration-fast ease-out',
          selected ? 'border-[var(--border-strong)] bg-surface-selected shadow-card' : 'border-[var(--border-card)] bg-surface-1 shadow-card hover:border-[var(--border-strong)] hover:bg-surface-2'
        )}
      >
        {hasTitle && (
          <h3 className="line-clamp-2 text-md font-semibold leading-snug text-fg">
            {note.emoji && <span className="mr-1.5">{note.emoji}</span>}
            {note.title}
          </h3>
        )}

        {isProcessing ? (
          <div className={hasTitle ? 'mt-2' : ''}>{shimmer}</div>
        ) : preview ? (
          <p className={cn('line-clamp-8 whitespace-pre-wrap break-words text-sm text-fg-secondary', hasTitle && 'mt-1.5')}>{preview}</p>
        ) : !hasTitle ? (
          <p className="text-sm text-fg-muted">Пустая заметка</p>
        ) : null}

        <div className="mt-3 flex items-center gap-1.5 text-xs text-fg-muted">
          {note.pinned && <PinIcon filled className="h-3 w-3" />}
          <span>{formatNoteDate(note.updatedAt)}</span>
        </div>

        {actions}
      </article>
      <Menu {...menu} aria-label="Действия с заметкой">
        <NoteMenuItems note={note} />
      </Menu>
    </>
  )
}
