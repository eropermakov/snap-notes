import type { ReactElement } from 'react'
import { useAppStore } from '../store/useAppStore'
import { SearchIcon, GridIcon, ListIcon, GearIcon, QuestionIcon, TrashIcon } from './icons'

export default function SearchBar(): ReactElement {
  const searchQuery = useAppStore((s) => s.searchQuery)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const viewMode = useAppStore((s) => s.viewMode)
  const setViewMode = useAppStore((s) => s.setViewMode)
  const openSettings = useAppStore((s) => s.openSettings)
  const openInstructions = useAppStore((s) => s.openInstructions)
  const openTrash = useAppStore((s) => s.openTrash)

  return (
    <div className="flex items-center gap-3 border-b border-surface-border bg-bg/90 px-6 py-4 backdrop-blur">
      <div className="flex flex-1 items-center gap-2 rounded-full border border-surface-border bg-surface px-4 py-2.5 shadow-card transition-shadow focus-within:shadow-card-hover">
        <SearchIcon className="h-4 w-4 shrink-0 text-muted" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Поиск по заметкам..."
          className="w-full bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none"
        />
      </div>

      <div className="flex items-center gap-1 rounded-full border border-surface-border bg-surface p-1 shadow-card">
        <button
          onClick={() => setViewMode('grid')}
          className={`rounded-full p-2 transition-colors ${
            viewMode === 'grid' ? 'bg-accent-light text-accent' : 'text-muted hover:bg-accent-light/60'
          }`}
          title="Сетка"
        >
          <GridIcon className="h-4 w-4" />
        </button>
        <button
          onClick={() => setViewMode('list')}
          className={`rounded-full p-2 transition-colors ${
            viewMode === 'list' ? 'bg-accent-light text-accent' : 'text-muted hover:bg-accent-light/60'
          }`}
          title="Список"
        >
          <ListIcon className="h-4 w-4" />
        </button>
      </div>

      <button
        onClick={() => void openTrash()}
        className="rounded-full border border-surface-border bg-surface p-2.5 text-muted shadow-card transition-colors hover:text-accent"
        title="Корзина"
      >
        <TrashIcon className="h-4 w-4" />
      </button>
      <button
        onClick={openSettings}
        className="rounded-full border border-surface-border bg-surface p-2.5 text-muted shadow-card transition-colors hover:text-accent"
        title="Настройки"
      >
        <GearIcon className="h-4 w-4" />
      </button>
      <button
        onClick={openInstructions}
        className="rounded-full border border-surface-border bg-surface p-2.5 text-muted shadow-card transition-colors hover:text-accent"
        title="Инструкция"
      >
        <QuestionIcon className="h-4 w-4" />
      </button>
    </div>
  )
}
