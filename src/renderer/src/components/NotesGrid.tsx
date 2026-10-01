import { useMemo, useRef, type ReactElement } from 'react'
import Masonry from 'react-masonry-css'
import type { Note } from '@shared/types'
import { useAppStore } from '../store/useAppStore'
import { useElementWidth } from '../hooks/useLayout'
import { Button, EmptyState, Kbd } from '../ui'
import NoteCard from './NoteCard'
import { formatAccelerator } from './HotkeyRecorder'
import { byRecent, matchesQuery } from './notes/noteFilters'
import { ScanDocIcon } from './icons'

const MIN_COLUMN = 232
const GAP = 12

/** Masonry columns follow the workspace width (the editor panel and sidebar take space too). */
function columnsFor(width: number): number {
  if (width <= 0) return 1
  return Math.max(1, Math.min(5, Math.floor((width + GAP) / (MIN_COLUMN + GAP))))
}

export default function NotesGrid(): ReactElement {
  const notes = useAppStore((s) => s.notes)
  const searchQuery = useAppStore((s) => s.searchQuery)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const viewMode = useAppStore((s) => s.viewMode)
  const filter = useAppStore((s) => s.notesFilter)
  const region = useAppStore((s) => s.settings?.hotkeys.region ?? 'Control+Shift+S')
  const containerRef = useRef<HTMLDivElement>(null)
  const width = useElementWidth(containerRef)

  const { pinned, others } = useMemo(() => {
    const visible = notes.filter((n) => matchesQuery(n, searchQuery) && (filter !== 'pinned' || n.pinned)).sort(byRecent)
    return { pinned: visible.filter((n) => n.pinned), others: visible.filter((n) => !n.pinned) }
  }, [notes, searchQuery, filter])

  const total = pinned.length + others.length

  let empty: ReactElement | null = null
  if (total === 0) {
    if (searchQuery.trim()) {
      empty = (
        <EmptyState
          size="sm"
          title="Ничего не найдено"
          description={`По запросу «${searchQuery.trim()}» заметок нет.`}
          action={
            <Button variant="ghost" size="sm" onClick={() => setSearchQuery('')}>
              Сбросить поиск
            </Button>
          }
        />
      )
    } else if (filter === 'pinned' && notes.length > 0) {
      empty = <EmptyState size="sm" title="Нет закреплённых заметок" description="Закрепите важное через меню заметки — оно всегда будет сверху." />
    } else {
      empty = (
        <EmptyState
          title="Пока нет заметок"
          description={
            <>
              Выделите текст на экране хоткеем <Kbd>{formatAccelerator(region)}</Kbd> — он распознается и появится здесь. Или
              создайте заметку вручную.
            </>
          }
          action={
            <Button variant="secondary" icon={<ScanDocIcon />} onClick={() => void window.api.app.captureDocument()}>
              Документ из скриншота
            </Button>
          }
        />
      )
    }
  }

  const columns = columnsFor(width)

  const renderGroup = (title: string, items: Note[]): ReactElement | null => {
    if (items.length === 0) return null
    return (
      <section className="mb-8 last:mb-0" key={title || 'group'} aria-label={title || 'Заметки'}>
        {title && <h2 className="mb-2 px-1 text-xs font-medium text-fg-muted">{title}</h2>}
        {viewMode === 'grid' ? (
          <Masonry breakpointCols={columns} className="flex w-auto gap-3" columnClassName="flex min-w-0 flex-col gap-3">
            {items.map((note) => (
              <NoteCard key={note.id} note={note} />
            ))}
          </Masonry>
        ) : (
          <div className="-mx-4 flex flex-col gap-px">
            {items.map((note) => (
              <NoteCard key={note.id} note={note} listMode />
            ))}
          </div>
        )}
      </section>
    )
  }

  const showGroups = filter === 'all' && pinned.length > 0

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={viewMode === 'list' ? 'mx-auto w-full max-w-[880px] px-6 pb-12' : 'px-6 pb-12'}>
        <div ref={containerRef}>
        {empty ??
          (showGroups ? (
            <>
              {renderGroup('Закреплённые', pinned)}
              {renderGroup('Остальные', others)}
            </>
          ) : (
            renderGroup('', [...pinned, ...others])
          ))}
        </div>
      </div>
    </div>
  )
}
