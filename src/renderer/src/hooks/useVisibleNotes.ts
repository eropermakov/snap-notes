import { useMemo } from 'react'
import type { Note } from '@shared/types'
import { filterNotes, sortNotes, type SortOrder } from '@shared/noteList'
import { SearchIndex, type SearchResult } from '@shared/noteSearch'
import { useAppStore, type NotesFilter } from '../store/useAppStore'
import { useDebouncedValue } from './useDebouncedValue'

/** Search typed in the box is applied after this quiet time (never per keystroke). */
export const SEARCH_DEBOUNCE_MS = 200

/** One index for the whole window: notes are re-indexed only when their content changed. */
const index = new SearchIndex()

export interface VisibleNotes {
  /** Notes to show, in display order (pinned first, then the chosen sort or search relevance). */
  notes: Note[]
  /** Search hits by note id (empty when not searching). */
  hits: Map<string, SearchResult>
  query: string
  searching: boolean
}

export function useDebouncedQuery(): string {
  const query = useAppStore((s) => s.searchQuery)
  return useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS)
}

/**
 * The notes of the current collection / tag, searched and sorted. Everything is memoized on its
 * inputs, so rendering does not recompute the collection and typing does not search per keystroke.
 */
export function useVisibleNotes(filterOverride?: NotesFilter): VisibleNotes {
  const notes = useAppStore((s) => s.notes)
  const storeFilter = useAppStore((s) => s.notesFilter)
  const tag = useAppStore((s) => s.tagFilter)
  const folderId = useAppStore((s) => s.activeFolderId)
  const sort: SortOrder = useAppStore((s) => s.settings?.sortOrder ?? 'modified')
  const query = useDebouncedQuery()
  const filter = filterOverride ?? storeFilter

  return useMemo(() => {
    const collection = filterNotes(notes, { filter: filter === 'trash' ? 'all' : filter, tag, folderId })
    if (!query) {
      return { notes: sortNotes(collection, filter === 'recent' ? 'modified' : sort), hits: new Map(), query: '', searching: false }
    }
    index.update(notes)
    const scope = new Set(collection.map((n) => n.id))
    const results = index.search(query, scope)
    const byId = new Map(collection.map((n) => [n.id, n]))
    const hits = new Map(results.map((r) => [r.id, r]))
    // Pinned notes stay on top; inside each group the most relevant match comes first.
    const ordered = results.map((r) => byId.get(r.id)).filter((n): n is Note => Boolean(n))
    const pinned = ordered.filter((n) => n.pinned)
    return { notes: [...pinned, ...ordered.filter((n) => !n.pinned)], hits, query, searching: true }
  }, [notes, filter, tag, folderId, sort, query])
}

/** Search across every note (command palette), ignoring the current collection. */
export function searchAllNotes(notes: Note[], query: string, limit = 30): { note: Note; hit: SearchResult }[] {
  index.update(notes)
  const byId = new Map(notes.map((n) => [n.id, n]))
  return index
    .search(query, undefined, limit)
    .map((hit) => ({ note: byId.get(hit.id) as Note, hit }))
    .filter((r) => r.note)
}
