import { describe, expect, it } from 'vitest'
import { extractBlockItems, looksLikeJsonAttempt } from '../../src/shared/structuredJson'
import { itemsToBlocks, plainTextToItems } from '../../src/shared/aiBlocks'

const withoutIds = (items: ReturnType<typeof itemsToBlocks>): unknown[] =>
  items.map((item) => {
    const { id: _id, ...rest } = item
    return rest
  })
const tryParseOcrBlocks = (raw: string): unknown[] | null => {
  const items = extractBlockItems(raw)
  return items ? withoutIds(itemsToBlocks(items)) : null
}
const parseOcrBlocks = (raw: string): unknown[] => tryParseOcrBlocks(raw) ?? withoutIds(itemsToBlocks(plainTextToItems(raw)))

describe('structured JSON extraction', () => {
  it('accepts the {"blocks": [...]} object and legacy bare arrays', () => {
    expect(extractBlockItems('{"blocks":[{"type":"paragraph","text":"a"}]}')).toHaveLength(1)
    expect(extractBlockItems('[{"type":"paragraph","text":"a"}]')).toHaveLength(1)
  })

  it('strips fences, <think> reasoning and surrounding prose', () => {
    const raw = '<think>let me look [1]</think>Here you go:\n```json\n{"blocks":[{"type":"heading","text":"Тариф Pro"}]}\n```'
    expect(tryParseOcrBlocks(raw)).toEqual([{ type: 'heading', level: 2, html: 'Тариф Pro' }])
  })

  it('repairs trailing commas', () => {
    expect(extractBlockItems('{"blocks":[{"type":"paragraph","text":"a"},],}')).toHaveLength(1)
  })

  it('recovers complete blocks from a truncated response', () => {
    const raw = '{"blocks":[{"type":"paragraph","text":"первый"},{"type":"paragraph","text":"второй"},{"type":"par'
    expect(tryParseOcrBlocks(raw)).toEqual([
      { type: 'paragraph', html: 'первый' },
      { type: 'paragraph', html: 'второй' }
    ])
  })

  it('keeps brackets inside strings intact', () => {
    const raw = '{"blocks":[{"type":"paragraph","text":"a [b] {c}, d"}]}'
    expect(tryParseOcrBlocks(raw)).toEqual([{ type: 'paragraph', html: 'a [b] {c}, d' }])
  })

  it('returns null for non-JSON, and the lenient parser keeps the text as paragraphs', () => {
    expect(tryParseOcrBlocks('Просто текст\n\nВторой абзац')).toBeNull()
    expect(parseOcrBlocks('Просто текст\n\nВторой абзац')).toEqual([
      { type: 'paragraph', html: 'Просто текст' },
      { type: 'paragraph', html: 'Второй абзац' }
    ])
    expect(looksLikeJsonAttempt('Просто текст')).toBe(false)
  })

  it('validates block shapes and keeps empty table cells in place', () => {
    const raw = JSON.stringify({
      blocks: [
        { type: 'table', rows: [['Компания', 'Цена'], ['Apple', ''], ['Samsung', 120]] },
        { type: 'bullet_list', items: ['100 ГБ', 'Без рекламы', ''] },
        { type: 'numbered_list', items: ['один'] },
        { type: 'evil', html: '<script>' },
        'garbage'
      ]
    })
    expect(tryParseOcrBlocks(raw)).toEqual([
      { type: 'table', header: true, rows: [['Компания', 'Цена'], ['Apple', ''], ['Samsung', '120']] },
      { type: 'bullet_list', items: ['100 ГБ', 'Без рекламы'] },
      { type: 'numbered_list', items: ['один'] }
    ])
  })
})
