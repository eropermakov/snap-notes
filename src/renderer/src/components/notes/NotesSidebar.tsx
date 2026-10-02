import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import type { Note } from '@shared/types'
import type { SearchResult } from '@shared/noteSearch'
import { collectTags, recentNotes } from '@shared/noteList'
import { DRAG_MIME, decodeDragIds, folderCounts } from '@shared/folders'
import { useAppStore } from '../../store/useAppStore'
import { searchAllNotes, useDebouncedQuery } from '../../hooks/useVisibleNotes'
import { cn, DropdownMenu, IconButton, Menu, MenuItem, MenuSeparator, SearchInput, SidebarHeader, SidebarItem, SidebarSection, Spinner, useContextMenu } from '../../ui'
import { ChevronDownIcon, ChevronRightIcon, ClockIcon, EditIcon, FolderIcon, InboxIcon, MoreIcon, PinIcon, PlusIcon, StarIcon, TagIcon, TrashIcon } from '../icons'
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
  const folders = useAppStore((s) => s.folders)
  const activeFolderId = useAppStore((s) => s.activeFolderId)
  const setActiveFolder = useAppStore((s) => s.setActiveFolder)
  const openFolderDialog = useAppStore((s) => s.openFolderDialog)
  const moveNotes = useAppStore((s) => s.moveNotes)
  const [foldersOpen, setFoldersOpen] = useState(() => {
    try {
      return localStorage.getItem('snap-notes:folders-open') !== '0'
    } catch {
      return true
    }
  })
  const [dropTarget, setDropTarget] = useState<string | null | undefined>(undefined)
  const folderNoteCounts = useMemo(() => folderCounts(notes), [notes])

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
    setActiveFolder(null)
    setFilter('all')
  }
  const toggleFolders = (): void => {
    setFoldersOpen((open) => {
      try {
        localStorage.setItem('snap-notes:folders-open', open ? '0' : '1')
      } catch {
        /* a view preference only */
      }
      return !open
    })
  }
  /** Notes dragged from the grid can be dropped on a folder (or on "Все заметки" to take them out of one). */
  function dropHandlers(folderId: string | null): {
    onDragOver: (e: React.DragEvent) => void
    onDragLeave: () => void
    onDrop: (e: React.DragEvent) => void
  } {
    return {
      onDragOver: (e) => {
        if (!Array.from(e.dataTransfer.types).includes(DRAG_MIME)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDropTarget(folderId)
      },
      onDragLeave: () => setDropTarget((current) => (current === folderId ? undefined : current)),
      onDrop: (e) => {
        const ids = decodeDragIds(e.dataTransfer.getData(DRAG_MIME))
        setDropTarget(undefined)
        if (ids.length) {
          e.preventDefault()
          void moveNotes(ids, folderId)
        }
      }
    }
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
        <SidebarItem
          icon={<InboxIcon />}
          label="Все заметки"
          count={notes.length}
          active={filter === 'all' && !tagFilter && !activeFolderId}
          onClick={showAll}
          dropActive={dropTarget === null}
          {...dropHandlers(null)}
        />
        <SidebarItem icon={<ClockIcon />} label="Недавние" active={filter === 'recent'} onClick={() => setFilter('recent')} />
        <SidebarItem icon={<StarIcon />} label="Избранное" count={counts.favorites || undefined} active={filter === 'favorites'} onClick={() => setFilter('favorites')} />
        <SidebarItem icon={<PinIcon />} label="Закреплённые" count={counts.pinned || undefined} active={filter === 'pinned'} onClick={() => setFilter('pinned')} />
        <SidebarItem icon={<TrashIcon />} label="Корзина" count={trashCount || undefined} active={filter === 'trash'} onClick={() => setFilter('trash')} />
      </SidebarSection>

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {!searching && (
          <SidebarSection
            title={
              <button type="button" onClick={toggleFolders} aria-expanded={foldersOpen} className="flex items-center gap-1 rounded text-left hover:text-fg">
                {foldersOpen ? <ChevronDownIcon className="h-3 w-3" /> : <ChevronRightIcon className="h-3 w-3" />}
                Папки
              </button>
            }
          >
            {foldersOpen && (
              <>
                {folders.map((folder) => (
                  <FolderRow
                    key={folder.id}
                    id={folder.id}
                    name={folder.name}
                    count={folderNoteCounts.get(folder.id)}
                    active={activeFolderId === folder.id && filter === 'all'}
                    dropActive={dropTarget === folder.id}
                    drop={dropHandlers(folder.id)}
                  />
                ))}
                <SidebarItem icon={<PlusIcon />} label="Новая папка" muted onClick={() => openFolderDialog({ type: 'create' })} />
              </>
            )}
          </SidebarSection>
        )}

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

interface FolderRowProps {
  id: string
  name: string
  count?: number
  active: boolean
  dropActive: boolean
  drop: { onDragOver: (e: React.DragEvent) => void; onDragLeave: () => void; onDrop: (e: React.DragEvent) => void }
}

function FolderRow({ id, name, count, active, dropActive, drop }: FolderRowProps): ReactElement {
  const setActiveFolder = useAppStore((s) => s.setActiveFolder)
  const openFolderDialog = useAppStore((s) => s.openFolderDialog)
  const createNote = useAppStore((s) => s.createNote)
  const { onContextMenu, menu } = useContextMenu()
  const items = (
    <>
      <MenuItem
        icon={<PlusIcon />}
        onSelect={() => {
          setActiveFolder(id)
          void createNote()
        }}
      >
        Новая заметка в папке
      </MenuItem>
      <MenuItem icon={<EditIcon />} onSelect={() => openFolderDialog({ type: 'rename', folderId: id })}>
        Переименовать
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<TrashIcon />} danger onSelect={() => openFolderDialog({ type: 'delete', folderId: id })}>
        Удалить папку…
      </MenuItem>
    </>
  )
  return (
    <>
      <SidebarItem
        icon={<FolderIcon />}
        label={name}
        count={count}
        active={active}
        title={name}
        onClick={() => setActiveFolder(id)}
        onContextMenu={onContextMenu}
        dropActive={dropActive}
        {...drop}
        actions={
          <DropdownMenu
            label="Действия с папкой"
            placement="bottom-start"
            trigger={(p) => <IconButton {...p} label="Действия с папкой" tooltip={false} size="sm" icon={<MoreIcon />} className="h-6 w-6" />}
          >
            {items}
          </DropdownMenu>
        }
      />
      <Menu {...menu} aria-label="Действия с папкой">
        {items}
      </Menu>
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
