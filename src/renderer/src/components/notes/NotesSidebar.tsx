import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import type { Note } from '@shared/types'
import type { SearchResult } from '@shared/noteSearch'
import { collectTags, recentNotes } from '@shared/noteList'
import { useAppStore } from '../../store/useAppStore'
import { searchAllNotes, useDebouncedQuery } from '../../hooks/useVisibleNotes'
import { cn, DropdownMenu, IconButton, Menu, SearchInput, SidebarHeader, SidebarItem, SidebarSection, Spinner, useContextMenu } from '../../ui'
import { ClockIcon, InboxIcon, MoreIcon, PinIcon, PlusIcon, StarIcon, TagIcon, TrashIcon } from '../icons'
import NoteMenuItems from './NoteMenuItems'
import { Highlight } from './Highlight'
import { noteLabel } from './noteFilters'

const RECENT_IN_SIDEBAR = 8

/** Context navigation for the notes section: search, collections, tags, last edited notes. */
export default function NotesSidebar(): ReactElement {
  const notes = useAppStore((s) => s.notes)
  const trashCount = useAppStore((s) => s.trashNotes.length)
  const filter = useAppStore((s) => s.notesFilter)
  const setFilter = useAppStore((s) => s.setNotesFilter)
  const tagFilter = useAppStore((s) => s.tagFilter)
  const setTagFilter = useAppStore((s) => s.setTagFilter)
  const searchQuery = useAppStore((s) => s.searchQuery)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const createNote = useAppStore((s) => s.createNote)
  const openNote = useAppStore((s) => s.openNote)
  const focusTick = useAppStore((s) => s.searchFocusTick)
  const searchRef = useRef<HTMLInputElement>(null)
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (focusTick > 0) searchRef.current?.focus()
  }, [focusTick])

  const query = useDebouncedQuery()
  const counts = useMemo(
    () => ({ pinned: notes.filter((n) => n.pinned).length, favorites: notes.filter((n) => n.favorite).length }),
    [notes]
  )
  const tags = useMemo(() => collectTags(notes), [notes])
  const results = useMemo(() => (query ? searchAllNotes(notes, query, 40) : []), [notes, query])
  const recent = useMemo(() => recentNotes(notes, RECENT_IN_SIDEBAR), [notes])

  useEffect(() => setActive(0), [query])

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (!query) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(results.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      const target = results[active] ?? results[0]
      if (target) {
        e.preventDefault()
        openNote(target.note.id, query)
      }
    }
  }

  const searching = searchQuery.trim().length > 0
  const showAll = (): void => {
    setTagFilter(null)
    setFilter('all')
  }

  return (
    <>
      <SidebarHeader
        title="Заметки"
        actions={<IconButton label="Новая заметка" shortcut="Ctrl+N" icon={<PlusIcon />} onClick={() => void createNote()} />}
      />
      <div className="px-3 pb-1">
        <SearchInput
          ref={searchRef}
          value={searchQuery}
          onChange={setSearchQuery}
          onKeyDown={onSearchKey}
          placeholder="Поиск"
          shortcut="Ctrl+F"
          size="sm"
          aria-label="Поиск по заметкам"
          aria-controls="sidebar-results"
          aria-activedescendant={searching && results[active] ? `sr-${results[active].note.id}` : undefined}
        />
      </div>

      <SidebarSection>
        <SidebarItem icon={<InboxIcon />} label="Все заметки" count={notes.length} active={filter === 'all' && !tagFilter} onClick={showAll} />
        <SidebarItem icon={<ClockIcon />} label="Недавние" active={filter === 'recent'} onClick={() => setFilter('recent')} />
        <SidebarItem icon={<StarIcon />} label="Избранное" count={counts.favorites || undefined} active={filter === 'favorites'} onClick={() => setFilter('favorites')} />
        <SidebarItem icon={<PinIcon />} label="Закреплённые" count={counts.pinned || undefined} active={filter === 'pinned'} onClick={() => setFilter('pinned')} />
        <SidebarItem icon={<TrashIcon />} label="Корзина" count={trashCount || undefined} active={filter === 'trash'} onClick={() => setFilter('trash')} />
      </SidebarSection>

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {tags.length > 0 && !searching && (
          <SidebarSection title="Теги">
            {tags.slice(0, 30).map(({ tag, count }) => (
              <SidebarItem
                key={tag}
                icon={<TagIcon />}
                label={tag}
                count={count}
                active={tagFilter === tag}
                onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
              />
            ))}
          </SidebarSection>
        )}

        {searching ? (
          <SidebarSection title="Найдено">
            <div id="sidebar-results" role="listbox" aria-label="Результаты поиска" className="flex flex-col gap-px">
              {results.map(({ note, hit }, i) => (
                <ResultItem key={note.id} note={note} hit={hit} active={i === active} query={query} />
              ))}
            </div>
            {results.length === 0 && query && <p className="px-2 py-3 text-sm text-fg-muted">Ничего не найдено</p>}
          </SidebarSection>
        ) : (
          recent.length > 0 && (
            <SidebarSection title="Последние изменённые">
              {recent.map((note) => (
                <RecentNoteItem key={note.id} note={note} />
              ))}
            </SidebarSection>
          )
        )}
      </div>
    </>
  )
}

function ResultItem({ note, hit, active, query }: { note: Note; hit: SearchResult; active: boolean; query: string }): ReactElement {
  const openNote = useAppStore((s) => s.openNote)
  const current = useAppStore((s) => s.editorNoteId === note.id)
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])
  return (
    <button
      ref={ref}
      id={`sr-${note.id}`}
      type="button"
      role="option"
      aria-selected={active}
      onClick={() => openNote(note.id, query)}
      className={cn(
        'flex w-full flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-fast hover:bg-hover',
        (active || current) && 'bg-active'
      )}
    >
      <span className="w-full truncate text-base font-medium text-fg">
        {note.emoji && <span className="mr-1.5">{note.emoji}</span>}
        {note.title.trim() ? <Highlight text={note.title} ranges={hit.titleRanges} /> : <span className="font-normal text-fg-secondary">{noteLabel(note)}</span>}
      </span>
      {hit.snippet && (
        <span className="line-clamp-2 w-full text-sm text-fg-secondary">
          <Highlight text={hit.snippet} ranges={hit.snippetRanges} />
        </span>
      )}
      {!hit.snippet && hit.matchedIn.includes('tags') && <span className="text-xs text-fg-muted">Совпадение в тегах</span>}
    </button>
  )
}

function RecentNoteItem({ note }: { note: Note }): ReactElement {
  const openNote = useAppStore((s) => s.openNote)
  const active = useAppStore((s) => s.editorNoteId === note.id)
  const processing = useAppStore((s) => s.processingIds.includes(note.id))
  const { onContextMenu, menu } = useContextMenu()

  return (
    <>
      <SidebarItem
        label={
          <>
            {note.emoji && <span className="mr-1.5">{note.emoji}</span>}
            {noteLabel(note)}
          </>
        }
        trailing={
          processing ? (
            <Spinner className="h-3 w-3" />
          ) : note.favorite || note.pinned ? (
            <span className="flex items-center gap-1">
              {note.favorite && <StarIcon filled className="h-3 w-3" />}
              {note.pinned && <PinIcon filled className="h-3 w-3" />}
            </span>
          ) : undefined
        }
        muted={!note.title.trim()}
        active={active}
        onClick={() => openNote(note.id)}
        onContextMenu={onContextMenu}
        actions={
          <DropdownMenu
            label="Действия с заметкой"
            placement="bottom-start"
            trigger={(p) => <IconButton {...p} label="Действия" tooltip={false} size="sm" icon={<MoreIcon />} className="h-6 w-6" />}
          >
            <NoteMenuItems note={note} showOpen={false} />
          </DropdownMenu>
        }
      />
      <Menu {...menu} aria-label="Действия с заметкой">
        <NoteMenuItems note={note} />
      </Menu>
    </>
  )
}
