import { describe, expect, it } from 'vitest'
import { clampFontSize, sanitizeFontFamily, sanitizeUiSettings } from '../../src/shared/settingsSanitize'
import { cardMetrics, columnsFor } from '../../src/shared/cardLayout'
import { DEFAULT_SETTINGS } from '../../src/shared/types'
import { isContentPatch } from '../../src/shared/noteMeta'

describe('view and editor settings', () => {
  it('defaults keep the existing look: default font, 14 px, medium cards, sorted by last modified', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      editorFontFamily: '',
      editorFontSize: 14,
      cardSize: 'medium',
      compactGrid: false,
      sortOrder: 'modified',
      restoreLastNote: true,
      suggestClipboardOcr: false,
      ocrFeedback: 'visual'
    })
  })

  it('keeps the font size in 12–24 px', () => {
    expect(clampFontSize(5)).toBe(12)
    expect(clampFontSize(99)).toBe(24)
    expect(clampFontSize('18')).toBe(18)
    expect(clampFontSize('abc')).toBe(14)
  })

  it('accepts only plain font family names (they end up in CSS)', () => {
    expect(sanitizeFontFamily('Segoe UI')).toBe('Segoe UI')
    expect(sanitizeFontFamily('Times New Roman')).toBe('Times New Roman')
    expect(sanitizeFontFamily('x"; background:url(//evil)')).toBe('')
    expect(sanitizeFontFamily(42)).toBe('')
  })

  it('validates what the renderer sends and never lets it write window state', () => {
    const clean = sanitizeUiSettings({
      sortOrder: 'bogus' as never,
      cardSize: 'huge' as never,
      ocrFeedback: 'loud' as never,
      editorFontSize: 400,
      lastNoteId: '../../etc/passwd',
      compactGrid: 'yes' as never,
      windowState: { width: 1, height: 1 },
      floatingOnTop: true
    })
    expect(clean).toMatchObject({ sortOrder: 'modified', cardSize: 'medium', ocrFeedback: 'visual', editorFontSize: 24, lastNoteId: null, compactGrid: false })
    expect('windowState' in clean).toBe(false)
    expect('floatingOnTop' in clean).toBe(false)
    expect(sanitizeUiSettings({ lastNoteId: 'abc-123' }).lastNoteId).toBe('abc-123')
  })
})

describe('card size and compact grid', () => {
  it('small / medium / large change width, preview length and column count', () => {
    const small = cardMetrics('small', false)
    const medium = cardMetrics('medium', false)
    const large = cardMetrics('large', false)
    expect(small.minColumn).toBeLessThan(medium.minColumn)
    expect(medium.minColumn).toBeLessThan(large.minColumn)
    expect(small.previewLines).toBeLessThan(medium.previewLines)
    expect(medium.previewLines).toBeLessThan(large.previewLines)
    const width = 1400
    expect(columnsFor(width, small)).toBeGreaterThan(columnsFor(width, medium))
    expect(columnsFor(width, medium)).toBeGreaterThan(columnsFor(width, large))
  })

  it('compact grid tightens gaps and previews but keeps them readable', () => {
    for (const size of ['small', 'medium', 'large'] as const) {
      const normal = cardMetrics(size, false)
      const compact = cardMetrics(size, true)
      expect(compact.gap).toBeLessThan(normal.gap)
      expect(compact.previewLines).toBeLessThan(normal.previewLines)
      expect(compact.previewLines).toBeGreaterThanOrEqual(3)
      expect(compact.minColumn).toBe(normal.minColumn)
    }
  })

  it('always has at least one column', () => {
    expect(columnsFor(0, cardMetrics('medium', false))).toBe(1)
    expect(columnsFor(50, cardMetrics('large', false))).toBe(1)
  })
})

describe('what counts as editing', () => {
  it('only content changes move "last modified"; pin / favorite / colour do not', () => {
    expect(isContentPatch({ body: '<p>a</p>' })).toBe(true)
    expect(isContentPatch({ title: 'x' })).toBe(true)
    expect(isContentPatch({ tags: ['a'] })).toBe(true)
    expect(isContentPatch({ pinned: true })).toBe(false)
    expect(isContentPatch({ favorite: true, color: 'blue' })).toBe(false)
  })
})
