import type { Note } from './types'

export type SortOrder = 'modified' | 'created' | 'titleAsc' | 'titleDesc'

export const SORT_LABELS: Record<SortOrder, string> = {
  modified: 'Последнее изменение',
  created: 'Дата создания',
  titleAsc: 'Название А–Я',
  titleDesc: 'Название Я–А'
}

export function normalizeSortOrder(value: unknown): SortOrder {
  return value === 'created' || value === 'titleAsc' || value === 'titleDesc' ? value : 'modified'
}

/** Notes shown in the "Recent" collection: the most recently modified, no copy of the data. */
export const RECENT_LIMIT = 20

const collator = new Intl.Collator(['ru', 'en'], { numeric: true, sensitivity: 'base' })

function titleKey(note: Note): string {
  return note.title.trim()
}

export function compareNotes(sort: SortOrder): (a: Note, b: Note) => number {
  switch (sort) {
    case 'created':
      return (a, b) => b.createdAt - a.createdAt || b.updatedAt - a.updatedAt
    case 'titleAsc':
    case 'titleDesc': {
      const dir = sort === 'titleAsc' ? 1 : -1
      return (a, b) => {
        const ta = titleKey(a)
        const tb = titleKey(b)
        // Untitled notes go last in both directions.
        if (!ta !== !tb) return ta ? -1 : 1
        return dir * collator.compare(ta, tb) || b.updatedAt - a.updatedAt
      }
    }
    default:
      return (a, b) => b.updatedAt - a.updatedAt
  }
}

/** Pinned notes first (always), the chosen sort inside each group. Does not mutate the input. */
export function sortNotes(notes: readonly Note[], sort: SortOrder): Note[] {
  const compare = compareNotes(sort)
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return compare(a, b)
  })
}

export type CollectionFilter = 'all' | 'pinned' | 'favorites' | 'recent'

export interface FilterOptions {
  filter: CollectionFilter
  tag?: string | null
  /** Only notes in this folder. undefined / null = every note ("Все заметки"). */
  folderId?: string | null
}

export function recentNotes(notes: readonly Note[], limit = RECENT_LIMIT): Note[] {
  return [...notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
}

export function filterNotes(notes: readonly Note[], { filter, tag, folderId }: FilterOptions): Note[] {
  let result: readonly Note[] = notes
  if (folderId) result = result.filter((n) => n.folderId === folderId)
  if (filter === 'pinned') result = result.filter((n) => n.pinned)
  else if (filter === 'favorites') result = result.filter((n) => n.favorite)
  else if (filter === 'recent') result = recentNotes(result)
  if (tag) result = result.filter((n) => n.tags.includes(tag))
  return result as Note[]
}

export interface TagCount {
  tag: string
  count: number
}

export function collectTags(notes: readonly Note[]): TagCount[] {
  const counts = new Map<string, number>()
  for (const note of notes) for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || collator.compare(a.tag, b.tag))
}

export function splitPinned(sorted: readonly Note[]): { pinned: Note[]; others: Note[] } {
  return { pinned: sorted.filter((n) => n.pinned), others: sorted.filter((n) => !n.pinned) }
}
