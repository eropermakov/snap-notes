import { useMemo, type ReactElement } from 'react'
import Masonry from 'react-masonry-css'
import type { Note } from '@shared/types'
import { htmlToPlainText } from '@shared/htmlText'
import { useAppStore } from '../store/useAppStore'
import NoteCard from './NoteCard'
import EmptyState from './EmptyState'

const breakpoints = { default: 4, 1280: 3, 900: 2, 600: 1 }

function filterAndSort(notes: Note[], query: string): { pinned: Note[]; others: Note[] } {
  const q = query.trim().toLowerCase()
  const filtered = q
    ? notes.filter((n) => n.title.toLowerCase().includes(q) || htmlToPlainText(n.body).toLowerCase().includes(q))
    : notes
  const pinned = filtered.filter((n) => n.pinned).sort((a, b) => b.updatedAt - a.updatedAt)
  const others = filtered.filter((n) => !n.pinned).sort((a, b) => b.updatedAt - a.updatedAt)
  return { pinned, others }
}

export default function NotesGrid(): ReactElement {
  const notes = useAppStore((s) => s.notes)
  const searchQuery = useAppStore((s) => s.searchQuery)
  const viewMode = useAppStore((s) => s.viewMode)

  const { pinned, others } = useMemo(() => filterAndSort(notes, searchQuery), [notes, searchQuery])
  const hasAny = pinned.length + others.length > 0

  if (!hasAny) {
    return <EmptyState hasNotesAtAll={notes.length > 0} />
  }

  const renderGroup = (title: string, items: Note[]): ReactElement | null => {
    if (items.length === 0) return null
    return (
      <div className="mb-6" key={title || 'group'}>
        {title && <h2 className="mb-3 px-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>}
        {viewMode === 'grid' ? (
          <Masonry breakpointCols={breakpoints} className="flex w-auto gap-4" columnClassName="flex flex-col gap-4">
            {items.map((note) => (
              <NoteCard key={note.id} note={note} />
            ))}
          </Masonry>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((note) => (
              <NoteCard key={note.id} note={note} listMode />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      {renderGroup(pinned.length ? 'Закреплённые' : '', pinned)}
      {renderGroup(pinned.length ? 'Остальные' : '', others)}
    </div>
  )
}
