import { describe, expect, it } from 'vitest'
import { note } from './helpers'
import { collectTags, filterNotes, normalizeSortOrder, recentNotes, sortNotes, splitPinned } from '../../src/shared/noteList'
import { needsMetaMigration, readNoteMeta } from '../../src/shared/noteMeta'

describe('pin ordering', () => {
  const a = note({ id: 'a', title: 'Beta', createdAt: 1, updatedAt: 50 })
  const b = note({ id: 'b', title: 'alpha', createdAt: 2, updatedAt: 10, pinned: true })
  const c = note({ id: 'c', title: 'Gamma', createdAt: 3, updatedAt: 90 })
  const d = note({ id: 'd', title: 'Delta', createdAt: 4, updatedAt: 20, pinned: true })

  it('puts pinned notes first whatever the sort order', () => {
    for (const sort of ['modified', 'created', 'titleAsc', 'titleDesc'] as const) {
      const ids = sortNotes([a, b, c, d], sort).map((n) => n.id)
      expect(ids.slice(0, 2).sort()).toEqual(['b', 'd'])
      expect(ids.slice(2).sort()).toEqual(['a', 'c'])
    }
  })

  it('applies the chosen sort inside each group', () => {
    expect(sortNotes([a, b, c, d], 'modified').map((n) => n.id)).toEqual(['d', 'b', 'c', 'a'])
    expect(sortNotes([a, b, c, d], 'created').map((n) => n.id)).toEqual(['d', 'b', 'c', 'a'])
    expect(sortNotes([a, b, c, d], 'titleAsc').map((n) => n.id)).toEqual(['b', 'd', 'a', 'c'])
    expect(sortNotes([a, b, c, d], 'titleDesc').map((n) => n.id)).toEqual(['d', 'b', 'c', 'a'])
  })

  it('does not mutate its input and splits groups', () => {
    const input = [a, b, c, d]
    const sorted = sortNotes(input, 'modified')
    expect(input.map((n) => n.id)).toEqual(['a', 'b', 'c', 'd'])
    const { pinned, others } = splitPinned(sorted)
    expect(pinned.map((n) => n.id)).toEqual(['d', 'b'])
    expect(others.map((n) => n.id)).toEqual(['c', 'a'])
  })

  it('sorts untitled notes last in both title directions and compares numbers naturally', () => {
    const untitled = note({ id: 'u', title: '' })
    const n2 = note({ id: 'n2', title: 'Заметка 2' })
    const n10 = note({ id: 'n10', title: 'Заметка 10' })
    expect(sortNotes([untitled, n10, n2], 'titleAsc').map((n) => n.id)).toEqual(['n2', 'n10', 'u'])
    expect(sortNotes([untitled, n10, n2], 'titleDesc').map((n) => n.id)).toEqual(['n10', 'n2', 'u'])
  })

  it('falls back to "modified" for unknown stored sort values', () => {
    expect(normalizeSortOrder('nonsense')).toBe('modified')
    expect(normalizeSortOrder('titleDesc')).toBe('titleDesc')
  })
})

describe('collections', () => {
  const notes = [
    note({ id: '1', favorite: true, tags: ['работа'], updatedAt: 5 }),
    note({ id: '2', pinned: true, tags: ['работа', 'важно'], updatedAt: 4 }),
    note({ id: '3', favorite: true, pinned: true, updatedAt: 3 }),
    note({ id: '4', updatedAt: 2 })
  ]

  it('favorites are independent from pinning', () => {
    expect(filterNotes(notes, { filter: 'favorites' }).map((n) => n.id)).toEqual(['1', '3'])
    expect(filterNotes(notes, { filter: 'pinned' }).map((n) => n.id)).toEqual(['2', '3'])
  })

  it('filters by tag on top of a collection', () => {
    expect(filterNotes(notes, { filter: 'all', tag: 'работа' }).map((n) => n.id)).toEqual(['1', '2'])
    expect(filterNotes(notes, { filter: 'pinned', tag: 'работа' }).map((n) => n.id)).toEqual(['2'])
  })

  it('recent shows the most recently modified notes, not a copy of the data', () => {
    const many = Array.from({ length: 30 }, (_, i) => note({ id: `m${i}`, updatedAt: i }))
    const recent = filterNotes(many, { filter: 'recent' })
    expect(recent).toHaveLength(20)
    expect(recent[0]).toBe(many[29])
    expect(recentNotes(many, 3).map((n) => n.id)).toEqual(['m29', 'm28', 'm27'])
  })

  it('counts used tags, most used first', () => {
    expect(collectTags(notes)).toEqual([
      { tag: 'работа', count: 2 },
      { tag: 'важно', count: 1 }
    ])
  })
})

describe('migration of old notes', () => {
  it('detects notes written before 1.6 and gives safe defaults', () => {
    const old = { id: 'x', title: 'T', body: '<p>a</p>', pinned: true, createdAt: 1, updatedAt: 2, deletedAt: null }
    expect(needsMetaMigration(old)).toBe(true)
    expect(readNoteMeta(old)).toEqual({ favorite: false, color: 'default', tags: [] })
  })

  it('keeps valid metadata and repairs invalid values', () => {
    const stored = { favorite: true, color: 'teal', tags: ['#Работа', 'работа', '', 5], autoCreated: true, titleManual: true }
    expect(needsMetaMigration(stored)).toBe(false)
    expect(readNoteMeta(stored)).toEqual({ favorite: true, color: 'teal', tags: ['работа'], autoCreated: true, titleManual: true })
    expect(readNoteMeta({ favorite: 'yes', color: '#ff0000', tags: 'a' })).toEqual({ favorite: false, color: 'default', tags: [] })
  })
})
