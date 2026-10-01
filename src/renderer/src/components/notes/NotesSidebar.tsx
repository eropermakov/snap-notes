import { useEffect, useMemo, useRef, type ReactElement } from 'react'
import type { Note } from '@shared/types'
import { useAppStore } from '../../store/useAppStore'
import { DropdownMenu, IconButton, Menu, SearchInput, SidebarHeader, SidebarItem, SidebarSection, Spinner, useContextMenu } from '../../ui'
import { InboxIcon, MoreIcon, PinIcon, PlusIcon, TrashIcon } from '../icons'
import NoteMenuItems from './NoteMenuItems'
import { byRecent, matchesQuery, noteLabel } from './noteFilters'

/** Context navigation for the notes section: search, collections, recent notes. */
export default function NotesSidebar(): ReactElement {
  const notes = useAppStore((s) => s.notes)
  const trashCount = useAppStore((s) => s.trashNotes.length)
  const filter = useAppStore((s) => s.notesFilter)
  const setFilter = useAppStore((s) => s.setNotesFilter)
  const searchQuery = useAppStore((s) => s.searchQuery)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const createNote = useAppStore((s) => s.createNote)
  const focusTick = useAppStore((s) => s.searchFocusTick)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focusTick > 0) searchRef.current?.focus()
  }, [focusTick])

  const pinnedCount = useMemo(() => notes.filter((n) => n.pinned).length, [notes])
  const recent = useMemo(() => notes.filter((n) => matchesQuery(n, searchQuery)).sort(byRecent), [notes, searchQuery])

  return (
    <>
      <SidebarHeader
        title="Заметки"
        actions={<IconButton label="Новая заметка" shortcut="Ctrl+N" icon={<PlusIcon />} onClick={() => void createNote()} />}
      />
      <div className="px-3 pb-1">
        <SearchInput ref={searchRef} value={searchQuery} onChange={setSearchQuery} placeholder="Поиск" shortcut="Ctrl+F" size="sm" aria-label="Поиск по заметкам" />
      </div>

      <SidebarSection>
        <SidebarItem icon={<InboxIcon />} label="Все заметки" count={notes.length} active={filter === 'all'} onClick={() => setFilter('all')} />
        <SidebarItem icon={<PinIcon />} label="Закреплённые" count={pinnedCount || undefined} active={filter === 'pinned'} onClick={() => setFilter('pinned')} />
        <SidebarItem icon={<TrashIcon />} label="Корзина" count={trashCount || undefined} active={filter === 'trash'} onClick={() => setFilter('trash')} />
      </SidebarSection>

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {recent.length > 0 && (
          <SidebarSection title={searchQuery ? 'Найдено' : 'Недавние'}>
            {recent.map((note) => (
              <RecentNoteItem key={note.id} note={note} />
            ))}
          </SidebarSection>
        )}
        {recent.length === 0 && searchQuery && <p className="px-4 py-3 text-sm text-fg-muted">Ничего не найдено</p>}
      </div>
    </>
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
        trailing={processing ? <Spinner className="h-3 w-3" /> : undefined}
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
