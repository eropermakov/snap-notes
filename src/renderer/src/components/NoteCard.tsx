import { memo, useMemo, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactElement } from 'react'
import type { Note } from '@shared/types'
import type { SearchResult } from '@shared/noteSearch'
import { DRAG_MIME, encodeDragIds, idsForDrag } from '@shared/folders'
import type { CardMetrics } from '@shared/cardLayout'
import { useAppStore } from '../store/useAppStore'
import { cn, DropdownMenu, IconButton, Menu, useContextMenu } from '../ui'
import { CheckIcon, MoreIcon, PinIcon, StarIcon } from './icons'
import NoteMenuItems from './notes/NoteMenuItems'
import { TagChips } from './notes/TagChips'
import { Highlight } from './notes/Highlight'
import { noteLabel, notePreview } from './notes/noteFilters'
import { formatNoteDate } from '../utils/format'

export interface CardSelectMods {
  ctrl: boolean
  shift: boolean
}

interface Props {
  note: Note
  listMode?: boolean
  metrics: CardMetrics
  compact: boolean
  /** Search hit: highlighted title and the matching fragment instead of the plain preview. */
  hit?: SearchResult
  /** Selection click (Ctrl / Shift / checkbox). The parent knows the visible order for ranges. */
  onSelect: (id: string, mods: CardSelectMods) => void
}

const PREVIEW_CLAMP: Record<number, string> = { 3: 'line-clamp-3', 4: 'line-clamp-4', 7: 'line-clamp-7', 8: 'line-clamp-8', 14: 'line-clamp-14' }
/** Only the start of a long note is turned into a preview (cheap even for huge notes). */
const PREVIEW_SOURCE_CHARS = 6000

/**
 * A note is content first: title + text on a quiet surface. Pin / favorite / tags show as small
 * marks; actions appear on hover, focus or right-click. Selection has its own check mark and outline.
 */
function NoteCardImpl({ note, listMode, metrics, compact, hit, onSelect }: Props): ReactElement {
  const openNote = useAppStore((s) => s.openNote)
  const togglePin = useAppStore((s) => s.togglePin)
  const toggleFavorite = useAppStore((s) => s.toggleFavorite)
  const open = useAppStore((s) => s.editorNoteId === note.id)
  const selected = useAppStore((s) => s.selection.selected.includes(note.id))
  const selectionActive = useAppStore((s) => s.selection.selected.length > 0)
  const isProcessing = useAppStore((s) => s.processingIds.includes(note.id))
  const query = useAppStore((s) => (hit ? s.searchQuery.trim() : ''))
  const { onContextMenu, menu } = useContextMenu()

  const preview = useMemo(() => notePreview(note.body.length > PREVIEW_SOURCE_CHARS ? note.body.slice(0, PREVIEW_SOURCE_CHARS) : note.body), [note.body])
  const hasTitle = Boolean(note.emoji || note.title.trim())
  const colorClass = note.color !== 'default' ? `note-color-${note.color}` : ''

  const activate = (e: MouseEvent | KeyboardEvent): void => {
    const mods = { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }
    if (mods.ctrl || mods.shift) onSelect(note.id, mods)
    // While notes are selected, a plain click keeps selecting (like Keep) instead of opening.
    else if (selectionActive) onSelect(note.id, { ctrl: true, shift: false })
    else openNote(note.id, query || undefined)
  }

  const onDragStart = (e: DragEvent): void => {
    const selected = useAppStore.getState().selection.selected
    e.dataTransfer.setData(DRAG_MIME, encodeDragIds(idsForDrag(note.id, selected)))
    e.dataTransfer.effectAllowed = 'move'
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      activate(e)
    }
  }

  const stateLabel = [note.pinned ? 'закреплена' : '', note.favorite ? 'в избранном' : '', selected ? 'выбрана' : ''].filter(Boolean).join(', ')

  const actions = (
    <div
      className={cn(
        'flex items-center gap-0.5 rounded-lg opacity-0 transition-opacity duration-fast group-focus-within:opacity-100 group-hover:opacity-100 has-[[aria-expanded=true]]:opacity-100',
        listMode ? '' : 'absolute right-2 top-2 bg-[var(--surface-elevated)] p-0.5 shadow-popover'
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <IconButton
        size="sm"
        label={note.favorite ? 'Убрать из избранного' : 'В избранное'}
        icon={<StarIcon filled={note.favorite} />}
        active={note.favorite}
        onClick={() => void toggleFavorite(note.id)}
      />
      <IconButton
        size="sm"
        label={note.pinned ? 'Открепить' : 'Закрепить'}
        icon={<PinIcon filled={note.pinned} />}
        active={note.pinned}
        onClick={() => void togglePin(note.id)}
      />
      <DropdownMenu label="Действия с заметкой" trigger={(p) => <IconButton {...p} size="sm" label="Ещё" icon={<MoreIcon />} />}>
        <NoteMenuItems note={note} showOpen={false} />
      </DropdownMenu>
    </div>
  )

  const selectBox = (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={selected ? 'Снять выбор' : 'Выбрать заметку'}
      title={selected ? 'Снять выбор' : 'Выбрать'}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(note.id, { ctrl: true, shift: e.shiftKey })
      }}
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-opacity duration-fast',
        selected
          ? 'border-accent bg-accent text-accent-contrast opacity-100'
          : 'border-[var(--border-input)] bg-[var(--surface-elevated)] text-transparent opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-fg-muted',
        selectionActive && !selected && 'opacity-100'
      )}
    >
      <CheckIcon className="h-3 w-3" />
    </button>
  )

  const shimmer = (
    <div className="space-y-2 py-1" aria-label="Распознаётся…">
      <div className="h-2.5 w-full animate-shimmer rounded-full shimmer-bg" />
      <div className="h-2.5 w-4/5 animate-shimmer rounded-full shimmer-bg" />
      <div className="h-2.5 w-3/5 animate-shimmer rounded-full shimmer-bg" />
    </div>
  )

  const titleNode = hit && hit.titleRanges.length > 0 ? <Highlight text={note.title} ranges={hit.titleRanges} /> : note.title
  const bodyPreview = hit && hit.snippet ? <Highlight text={hit.snippet} ranges={hit.snippetRanges} /> : preview

  if (listMode) {
    return (
      <>
        <div
          role="button"
          tabIndex={0}
          aria-label={`${noteLabel(note)}${stateLabel ? ` — ${stateLabel}` : ''}`}
          aria-current={open || undefined}
          aria-pressed={selected || undefined}
          data-note-id={note.id}
          data-open={open}
          data-selected={selected}
          draggable
          onDragStart={onDragStart}
          onClick={activate}
          onKeyDown={onKeyDown}
          onContextMenu={onContextMenu}
          className={cn(
            'note-card group flex cursor-default items-center gap-3 rounded-xl border border-transparent px-4 transition-colors duration-fast',
            compact ? 'py-1.5' : 'py-2.5',
            colorClass
          )}
        >
          {selectBox}
          <div className="min-w-0 flex-1">
            <p className={cn('truncate text-base', hasTitle ? 'font-medium text-fg' : 'text-fg-secondary')}>
              {note.emoji && <span className="mr-1.5">{note.emoji}</span>}
              {note.title.trim() ? titleNode : preview ? preview.slice(0, 120) : 'Пустая заметка'}
            </p>
            {isProcessing ? (
              <div className="mt-1.5 h-2 w-2/3 animate-shimmer rounded-full shimmer-bg" />
            ) : (
              (note.title.trim() && (hit?.snippet || preview)) && <p className="mt-0.5 truncate text-sm text-fg-secondary">{bodyPreview}</p>
            )}
          </div>
          <div className="hidden shrink-0 md:block">
            <TagChips tags={note.tags} max={2} />
          </div>
          <div className="relative flex shrink-0 items-center">
            <span className="flex items-center gap-2 text-xs text-fg-muted transition-opacity duration-fast group-focus-within:opacity-0 group-hover:opacity-0 group-has-[[aria-expanded=true]]:opacity-0">
              {note.favorite && <StarIcon filled className="h-3 w-3" />}
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
        aria-label={`${noteLabel(note)}${stateLabel ? ` — ${stateLabel}` : ''}`}
        aria-current={open || undefined}
        aria-pressed={selected || undefined}
        data-note-id={note.id}
        data-open={open}
        data-selected={selected}
        draggable
        onDragStart={onDragStart}
        onClick={activate}
        onKeyDown={onKeyDown}
        onContextMenu={onContextMenu}
        className={cn(
          'note-card group relative flex cursor-default flex-col rounded-2xl border shadow-card transition-colors duration-fast ease-out',
          compact ? 'p-3' : metrics.previewLines >= 14 ? 'p-5' : 'p-4',
          colorClass
        )}
      >
        <div className="absolute -left-2 -top-2 z-[1]">{selectBox}</div>

        {hasTitle && (
          <h3 className="line-clamp-2 text-md font-semibold leading-snug text-fg">
            {note.emoji && <span className="mr-1.5">{note.emoji}</span>}
            {titleNode}
          </h3>
        )}

        {isProcessing ? (
          <div className={hasTitle ? 'mt-2' : ''}>{shimmer}</div>
        ) : bodyPreview ? (
          <p className={cn('whitespace-pre-wrap break-words text-sm text-fg-secondary', PREVIEW_CLAMP[metrics.previewLines] ?? 'line-clamp-8', hasTitle && 'mt-1.5')}>{bodyPreview}</p>
        ) : !hasTitle ? (
          <p className="text-sm text-fg-muted">Пустая заметка</p>
        ) : null}

        {note.tags.length > 0 && (
          <div className="mt-2.5">
            <TagChips tags={note.tags} />
          </div>
        )}

        <div className={cn('flex items-center gap-1.5 text-xs text-fg-muted', compact ? 'mt-2' : 'mt-3')}>
          {note.pinned && (
            <span className="inline-flex items-center gap-1" title="Закреплена">
              <PinIcon filled className="h-3 w-3" />
              <span className="sr-only">Закреплена</span>
            </span>
          )}
          {note.favorite && (
            <span className="inline-flex items-center gap-1" title="В избранном">
              <StarIcon filled className="h-3 w-3" />
              <span className="sr-only">В избранном</span>
            </span>
          )}
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

export default memo(NoteCardImpl)
