import { useCallback, useMemo, useRef, useState, type DragEvent, type ReactElement } from 'react'
import Masonry from 'react-masonry-css'
import type { Note } from '@shared/types'
import { cardMetrics, columnsFor } from '@shared/cardLayout'
import { splitPinned } from '@shared/noteList'
import { useAppStore } from '../store/useAppStore'
import { useElementWidth } from '../hooks/useLayout'
import type { VisibleNotes } from '../hooks/useVisibleNotes'
import { useProgressive } from '../hooks/useProgressive'
import { Button, EmptyState, Kbd, Spinner } from '../ui'
import NoteCard, { type CardSelectMods } from './NoteCard'
import { formatAccelerator } from './HotkeyRecorder'
import { ScanDocIcon } from './icons'
import { fileToPngBytes, imageFilesOf } from '../utils/imageFiles'

export default function NotesGrid({ visible: shown }: { visible: VisibleNotes }): ReactElement {
  const allNotes = useAppStore((s) => s.notes)
  const searchQuery = useAppStore((s) => s.searchQuery)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const viewMode = useAppStore((s) => s.viewMode)
  const filter = useAppStore((s) => s.notesFilter)
  const tagFilter = useAppStore((s) => s.tagFilter)
  const setTagFilter = useAppStore((s) => s.setTagFilter)
  const clickCard = useAppStore((s) => s.clickCard)
  const pushToast = useAppStore((s) => s.pushToast)
  const region = useAppStore((s) => s.settings?.hotkeys.region ?? 'Control+Shift+S')
  const cardSize = useAppStore((s) => s.settings?.cardSize ?? 'medium')
  const compact = useAppStore((s) => s.settings?.compactGrid ?? false)
  const containerRef = useRef<HTMLDivElement>(null)
  const width = useElementWidth(containerRef)
  const [dragging, setDragging] = useState(false)

  const { notes, hits, searching } = shown
  const metrics = useMemo(() => cardMetrics(cardSize, compact), [cardSize, compact])
  const columns = columnsFor(width, metrics)

  // The order on screen, for Shift+click ranges. Read through a ref so the callback stays stable.
  const orderRef = useRef<string[]>([])
  orderRef.current = notes.map((n) => n.id)
  const onSelect = useCallback((id: string, mods: CardSelectMods) => clickCard(id, mods, orderRef.current), [clickCard])

  const { visible, sentinel, hasMore } = useProgressive(notes)
  const groups = useMemo(() => {
    if (searching || filter === 'pinned') return null
    const { pinned, others } = splitPinned(visible)
    return pinned.length > 0 && others.length > 0 ? { pinned, others } : null
  }, [visible, searching, filter])

  const onDragOver = (e: DragEvent): void => {
    if (Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault()
      setDragging(true)
    }
  }
  const onDrop = async (e: DragEvent): Promise<void> => {
    setDragging(false)
    const files = imageFilesOf(e.dataTransfer.files)
    if (files.length === 0) return
    e.preventDefault()
    for (const file of files.slice(0, 5)) {
      try {
        const bytes = await fileToPngBytes(file)
        await window.api.notes.ocrImageData(null, bytes)
      } catch (err) {
        pushToast('error', (err as Error).message)
      }
    }
  }

  let empty: ReactElement | null = null
  if (notes.length === 0) {
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
    } else if (tagFilter) {
      empty = (
        <EmptyState
          size="sm"
          title={`Нет заметок с тегом #${tagFilter}`}
          action={
            <Button variant="ghost" size="sm" onClick={() => setTagFilter(null)}>
              Показать все
            </Button>
          }
        />
      )
    } else if (filter === 'pinned' && allNotes.length > 0) {
      empty = <EmptyState size="sm" title="Нет закреплённых заметок" description="Закрепите важное через меню заметки — оно всегда будет сверху." />
    } else if (filter === 'favorites' && allNotes.length > 0) {
      empty = <EmptyState size="sm" title="В избранном пусто" description="Отметьте заметку звёздочкой — она появится здесь." />
    } else if (filter === 'recent' && allNotes.length > 0) {
      empty = <EmptyState size="sm" title="Нет недавних заметок" />
    } else {
      empty = (
        <EmptyState
          title="Пока нет заметок"
          description={
            <>
              Выделите текст на экране хоткеем <Kbd>{formatAccelerator(region)}</Kbd> — он распознается и появится здесь. Или
              создайте заметку вручную. Картинку можно просто перетащить сюда.
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

  const renderItems = (items: Note[]): ReactElement =>
    viewMode === 'grid' ? (
      <Masonry
        breakpointCols={columns}
        className="flex w-auto"
        columnClassName="flex min-w-0 flex-col"
        style={{ gap: metrics.gap, ['--grid-gap' as string]: `${metrics.gap}px` }}
      >
        {items.map((note) => (
          <div key={note.id} style={{ marginBottom: metrics.gap }}>
            <NoteCard note={note} metrics={metrics} compact={compact} hit={hits.get(note.id)} onSelect={onSelect} />
          </div>
        ))}
      </Masonry>
    ) : (
      <div className="-mx-4 flex flex-col gap-px">
        {items.map((note) => (
          <NoteCard key={note.id} note={note} listMode metrics={metrics} compact={compact} hit={hits.get(note.id)} onSelect={onSelect} />
        ))}
      </div>
    )

  const renderGroup = (title: string, items: Note[]): ReactElement | null => {
    if (items.length === 0) return null
    return (
      <section className="mb-8 last:mb-0" key={title || 'group'} aria-label={title || 'Заметки'}>
        {title && <h2 className="mb-2 px-1 text-xs font-medium text-fg-muted">{title}</h2>}
        {renderItems(items)}
      </section>
    )
  }

  return (
    <div
      className="relative min-h-0 flex-1 overflow-y-auto"
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={(e) => void onDrop(e)}
    >
      <div className={viewMode === 'list' ? 'mx-auto w-full max-w-[880px] px-6 pb-12' : 'px-6 pb-12'}>
        <div ref={containerRef}>
          {empty ?? (groups ? (
            <>
              {renderGroup('Закреплённые', groups.pinned)}
              {renderGroup('Остальные', groups.others)}
            </>
          ) : (
            renderGroup('', visible)
          ))}
          {hasMore && (
            <div ref={sentinel} className="flex h-12 items-center justify-center text-fg-muted" aria-hidden>
              <Spinner className="h-4 w-4" />
            </div>
          )}
        </div>
      </div>
      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-accent-soft text-base font-medium text-fg">
          Отпустите, чтобы распознать текст с картинки в новую заметку
        </div>
      )}
    </div>
  )
}
