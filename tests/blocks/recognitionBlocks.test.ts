import { describe, expect, it } from 'vitest'
import { cleanOcrText, joinParagraphLines, isJunkLine } from '../../src/shared/ocrCleanup'
import { itemsToBlocks } from '../../src/shared/aiBlocks'
import { layoutToItems, type LayoutLine } from '../../src/shared/localLayout'
import { blocksToAiMarkdown } from '../../src/shared/blockExport'
import type { Block } from '../../src/shared/blocks'

const strip = (blocks: unknown[]): unknown[] => blocks.map((b) => ({ ...(b as Record<string, unknown>), id: undefined }))

describe('OCR cleanup — fixes artifacts, never rephrases', () => {
  it('whitespace, invisible chars, hyphenation, punctuation spacing', () => {
    expect(cleanOcrText('Распозна-\nвание  текста ,  ( скобки )​')).toBe('Распознавание текста, (скобки)')
  })
  it('keeps numbers, prices and decimals intact', () => {
    expect(cleanOcrText('Итого 15 000 ₽ , скидка .5 и 3.14')).toBe('Итого 15 000 ₽, скидка .5 и 3.14')
  })
  it('keeps real compound words split at a line end when the next part is capitalized', () => {
    expect(cleanOcrText('Санкт-\nПетербург')).toBe('Санкт-\nПетербург')
  })
  it('joins paragraph lines', () => {
    expect(joinParagraphLines(['Первая строка аб-', 'заца и вторая', 'строка.'])).toBe('Первая строка абзаца и вторая строка.')
  })
  it('detects junk lines', () => {
    expect(isJunkLine(' | ')).toBe(true)
    expect(isJunkLine('...')).toBe(true)
    expect(isJunkLine('A1')).toBe(false)
  })
})

describe('AI items → blocks', () => {
  it('the spec example: heading, list, button as "Кнопка: …"', () => {
    const blocks = itemsToBlocks([
      { type: 'heading', level: 1, text: 'Тариф Pro' },
      { type: 'bullet_list', items: ['• 100 ГБ', 'Без рекламы', '499 ₽ / месяц'] },
      { type: 'ui', role: 'button', text: 'Подключить' }
    ])
    expect(blocksToAiMarkdown(blocks as Block[])).toBe(
      '# Тариф Pro\n\n- 100 ГБ\n- Без рекламы\n- 499 ₽ / месяц\n\nКнопка: Подключить\n'
    )
  })

  it('groups consecutive buttons', () => {
    const [block] = itemsToBlocks([
      { type: 'ui', role: 'button', text: 'Отмена' },
      { type: 'ui', role: 'button', text: 'OK' }
    ]) as Block[]
    expect(block).toMatchObject({ type: 'paragraph', html: 'Кнопки: <span class="ui-chip">Отмена</span> <span class="ui-chip">OK</span>' })
  })

  it('code is copied verbatim: indentation, 0/O, straight quotes, no cleanup', () => {
    const code = 'if  (x == 0) {\n    print("O0 ,")\n}'
    const [block] = itemsToBlocks([{ type: 'code', language: 'Python', code }]) as Block[]
    expect(block).toMatchObject({ type: 'code', language: 'python', code })
  })

  it('tables are padded, links/e-mails linked, uncertain values marked', () => {
    const [table, para] = itemsToBlocks([
      { type: 'table', header: true, rows: [['Компания', 'Цена', 'Кол-во'], ['Apple', 100], ['Samsung', '120', '7']] },
      { type: 'paragraph', text: 'Итого 15 000 ₽, пишите support@example.com', uncertain: ['15 000 ₽'] }
    ]) as Block[]
    expect(table).toMatchObject({ rows: [['Компания', 'Цена', 'Кол-во'], ['Apple', '100', ''], ['Samsung', '120', '7']], header: true })
    expect(para).toMatchObject({
      html: 'Итого <span class="ocr-uncertain">15 000 ₽</span>, пишите <a href="mailto:support@example.com">support@example.com</a>'
    })
  })

  it('images become pending crops in reading order; bad bboxes are dropped', () => {
    const items = itemsToBlocks([
      { type: 'heading', text: 'H' },
      { type: 'image', bbox: [100, 0, 500, 1000] },
      { type: 'image', bbox: [500, 0, 100, 1000] },
      { type: 'paragraph', text: 'после' }
    ])
    expect(items.map((i) => i.type)).toEqual(['heading', 'pending_image', 'paragraph'])
  })

  it('accepts the legacy (1.x) schema and links blocks to their source', () => {
    const blocks = itemsToBlocks([{ type: 'list', ordered: true, items: ['1. один', 'два'] }, { type: 'label', text: 'Подпись' }], 'src1')
    expect(strip(blocks)).toEqual([
      { type: 'numbered_list', items: ['один', 'два'], sourceId: 'src1', id: undefined },
      { type: 'paragraph', html: 'Подпись', sourceId: 'src1', id: undefined }
    ])
  })

  it('never throws on garbage', () => {
    expect(itemsToBlocks([null, 1, 'x', { type: 'table', rows: 'no' }, { type: 'heading' }])).toEqual([])
  })
})

describe('local layout (Tesseract, no AI)', () => {
  const line = (text: string, y: number, x = 10, h = 14, words?: LayoutLine['words']): LayoutLine => ({
    text,
    confidence: 90,
    bbox: { x0: x, y0: y, x1: x + text.length * 7, y1: y + h },
    words
  })

  it('heading by height, paragraph joining, bullets, numbered list', () => {
    const items = layoutToItems([
      line('Тариф Pro', 0, 10, 26),
      line('Лучший выбор для ко-', 40),
      line('манды из пяти человек.', 58),
      line('• 100 ГБ', 90),
      line('• Без рекламы', 108),
      line('1. Первый шаг', 140),
      line('2. Второй шаг', 158)
    ])
    expect(items).toEqual([
      { type: 'heading', level: 1, text: 'Тариф Pro' },
      { type: 'paragraph', text: 'Лучший выбор для команды из пяти человек.' },
      { type: 'bullet_list', items: ['100 ГБ', 'Без рекламы'] },
      { type: 'numbered_list', items: ['Первый шаг', 'Второй шаг'] }
    ])
  })

  it('side-by-side columns become a table', () => {
    const items = layoutToItems([
      line('Компания', 0, 10),
      line('Цена', 0, 300),
      line('Apple', 20, 10),
      line('100', 20, 300),
      line('Samsung', 40, 10),
      line('120', 40, 300)
    ])
    expect(items).toEqual([{ type: 'table', header: true, rows: [['Компания', 'Цена'], ['Apple', '100'], ['Samsung', '120']] }])
  })

  it('code keeps indentation from x positions', () => {
    const items = layoutToItems([line('def main():', 0, 10), line('return {"a": 0};', 20, 38)])
    expect(items).toEqual([{ type: 'code', code: 'def main():\n    return {"a": 0};' }])
  })

  it('low-confidence words become uncertain; junk lines vanish', () => {
    const items = layoutToItems([
      line('|', 0),
      line('Счёт 15000 руб', 20, 10, 14, [
        { text: 'Счёт', confidence: 95 },
        { text: '15000', confidence: 41 },
        { text: 'руб', confidence: 90 }
      ])
    ])
    expect(items).toEqual([{ type: 'paragraph', text: 'Счёт 15000 руб', uncertain: ['15000'] }])
  })
})

describe('local layout — rows returned as one wide line (seen live with Tesseract)', () => {
  const word = (text: string, x0: number, y = 100, h = 24) => ({ text, confidence: 92, bbox: { x0, y0: y, x1: x0 + text.length * 11, y1: y + h } })
  const row = (y: number, cells: [string, number][]): LayoutLine => {
    const words = cells.map(([t, x]) => word(t, x, y))
    return { text: cells.map(([t]) => t).join(' '), confidence: 92, bbox: { x0: words[0].bbox.x0, y0: y, x1: words[words.length - 1].bbox.x1, y1: y + 24 }, words }
  }
  it('splits cells at wide gaps and detects the table', () => {
    const items = layoutToItems([
      row(0, [['Компания', 10], ['Цена', 300]]),
      row(40, [['Apple', 10], ['100', 300]]),
      row(80, [['Samsung', 10], ['120', 300]])
    ])
    expect(items).toEqual([{ type: 'table', header: true, rows: [['Компания', 'Цена'], ['Apple', '100'], ['Samsung', '120']] }])
  })
  it('keeps ordinary word spacing inside one cell', () => {
    const items = layoutToItems([row(0, [['Без', 10], ['рекламы', 52]])])
    expect(items).toEqual([{ type: 'paragraph', text: 'Без рекламы' }])
  })
})
