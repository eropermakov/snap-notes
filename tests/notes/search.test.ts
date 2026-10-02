import { afterEach, describe, expect, it, vi } from 'vitest'
import { SearchIndex, highlightParts, queryWords } from '../../src/shared/noteSearch'
import { debounce } from '../../src/shared/debounce'
import { note } from './helpers'

describe('search', () => {
  const notes = [
    note({ id: 'title', title: 'Отчёт по проекту', body: '<p>Привет</p>' }),
    note({ id: 'list', title: '', body: '<ul><li>молоко</li><li>хлеб</li></ul>' }),
    note({ id: 'table', body: '<table><tr><th>Имя</th><th>Город</th></tr><tr><td>Анна</td><td>Москва</td></tr></table>' }),
    note({ id: 'code', body: '<pre><code>function fetchUserData() {}</code></pre>' }),
    note({ id: 'ocr', body: '<p data-src="c1">Счёт-фактура № 12 от 5 мая</p>' }),
    note({ id: 'tags', title: 'Пусто', tags: ['бюджет'] })
  ]
  const index = new SearchIndex()
  index.update(notes)
  const ids = (q: string): string[] => index.search(q).map((r) => r.id)

  it('finds title, list items, table cells, code, OCR text and tags', () => {
    expect(ids('отчет')).toEqual(['title'])
    expect(ids('хлеб')).toEqual(['list'])
    expect(ids('москва')).toEqual(['table'])
    expect(ids('fetchuserdata')).toEqual(['code'])
    expect(ids('фактура')).toEqual(['ocr'])
    expect(ids('бюджет')).toEqual(['tags'])
    expect(ids('#бюджет')).toEqual(['tags'])
  })

  it('treats ё and е alike and ignores case', () => {
    expect(ids('ОТЧЕТ')).toEqual(['title'])
    expect(ids('счет')).toEqual(['ocr'])
  })

  it('requires every word to match', () => {
    expect(ids('анна москва')).toEqual(['table'])
    expect(ids('анна лондон')).toEqual([])
  })

  it('ranks title matches above body matches', () => {
    const idx = new SearchIndex()
    idx.update([note({ id: 'body', body: '<p>проект</p>' }), note({ id: 'name', title: 'Проект' })])
    expect(idx.search('проект').map((r) => r.id)).toEqual(['name', 'body'])
  })

  it('returns highlight ranges and a snippet around the match', () => {
    const long = `${'слово '.repeat(40)}нужная фраза здесь ${'конец '.repeat(40)}`
    const idx = new SearchIndex()
    idx.update([note({ id: 'l', body: `<p>${long}</p>` })])
    const [result] = idx.search('нужная')
    expect(result.snippet.startsWith('…')).toBe(true)
    const parts = highlightParts(result.snippet, result.snippetRanges)
    expect(parts.filter((p) => p.hit).map((p) => p.text.toLowerCase())).toEqual(['нужная'])
    expect(parts.map((p) => p.text).join('')).toBe(result.snippet)
  })

  it('limits the search to a scope (current collection)', () => {
    expect(index.search('хлеб', new Set(['title'])).map((r) => r.id)).toEqual([])
    expect(index.search('хлеб', new Set(['list'])).map((r) => r.id)).toEqual(['list'])
  })

  it('re-indexes only changed notes and forgets deleted ones', () => {
    const idx = new SearchIndex()
    const a = note({ id: 'a', body: '<p>one</p>' })
    idx.update([a])
    expect(idx.search('one')).toHaveLength(1)
    idx.update([{ ...a, body: '<p>two</p>', updatedAt: a.updatedAt + 1 }])
    expect(idx.search('one')).toHaveLength(0)
    expect(idx.search('two')).toHaveLength(1)
    idx.update([])
    expect(idx.size()).toBe(0)
  })

  it('returns nothing for an empty query', () => {
    expect(queryWords('   ')).toEqual([])
    expect(index.search('  ')).toEqual([])
  })
})

describe('search debounce', () => {
  afterEach(() => vi.useRealTimers())

  it('runs the search once, after the quiet period, with the last value', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const debounced = debounce(run, 200)
    debounced('п')
    debounced('пр')
    debounced('при')
    vi.advanceTimersByTime(199)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith('при')
  })

  it('can flush or cancel a pending call', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const debounced = debounce(run, 200)
    debounced('a')
    debounced.flush()
    expect(run).toHaveBeenCalledWith('a')
    debounced('b')
    debounced.cancel()
    vi.advanceTimersByTime(500)
    expect(run).toHaveBeenCalledTimes(1)
  })
})
