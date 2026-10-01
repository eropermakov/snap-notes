import { describe, expect, it } from 'vitest'
import {
  blocksToHtml,
  blocksToText,
  htmlToBlocks,
  markUncertain,
  normalizeBlocks,
  sanitizeInline,
  textToInline,
  type Block
} from '../../src/shared/blocks'
import {
  blocksToAiMarkdown,
  blocksToMarkdown,
  blocksToPlainText,
  blocksToRichHtml,
  tableToCsv,
  tableToTsv
} from '../../src/shared/blockExport'

const strip = (blocks: Block[]): unknown[] => blocks.map(({ id: _id, ...rest }) => rest)

describe('htmlToBlocks — legacy v1 note bodies keep opening', () => {
  it('converts everything the 1.x editor and OCR produced', () => {
    const legacy =
      '<p><strong>Тариф Pro</strong></p>' +
      '<ul><li>100 ГБ</li><li>Без <b>рекламы</b></li></ul>' +
      '<ol><li>один</li><li>два</li></ol>' +
      '<p><span class="ui-chip">Подключить</span></p>' +
      '<p class="ocr-flag">⚠️ Похоже, текст поместился не полностью</p>' +
      '<table><tr><td>Компания</td><td>Цена</td></tr><tr><td>Apple</td><td>100</td></tr></table>' +
      '<ul class="todo-list"><li class="todo-item done">купить</li><li class="todo-item">позвонить</li></ul>' +
      '<h3>Заголовок</h3>' +
      '<p><img class="doc-image" src="snap-media://note-1/img-1.png" alt=""></p>' +
      '<div>строка из div</div>' +
      'голый текст'
    expect(strip(htmlToBlocks(legacy))).toEqual([
      { type: 'paragraph', html: '<strong>Тариф Pro</strong>' },
      { type: 'bullet_list', items: ['100 ГБ', 'Без <strong>рекламы</strong>'] },
      { type: 'numbered_list', items: ['один', 'два'] },
      { type: 'paragraph', html: '<span class="ui-chip">Подключить</span>' },
      { type: 'paragraph', html: '⚠️ Похоже, текст поместился не полностью', tone: 'warning' },
      { type: 'table', rows: [['Компания', 'Цена'], ['Apple', '100']], header: false },
      { type: 'checklist', items: [{ html: 'купить', done: true }, { html: 'позвонить', done: false }] },
      { type: 'heading', level: 3, html: 'Заголовок' },
      { type: 'image', src: 'snap-media://note-1/img-1.png' },
      { type: 'paragraph', html: 'строка из div' },
      { type: 'paragraph', html: 'голый текст' }
    ])
  })

  it('splits an image out of the middle of a paragraph, keeping order', () => {
    const blocks = htmlToBlocks('<p>до<img src="snap-media://n/i.png">после</p>')
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'image', 'paragraph'])
  })

  it('keeps code exactly: indentation, newlines, 0 vs O, straight quotes, <tags>', () => {
    const code = 'def f():\n    if x == 0:\n        return "O0"  # <b>not bold</b>\n'
    const [block] = htmlToBlocks(`<pre data-lang="python"><code>${code.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code></pre>`)
    expect(block).toMatchObject({ type: 'code', language: 'python', code: code.replace(/\n$/, '') })
  })

  it('drops scripts, handlers and unsafe links', () => {
    const [block] = htmlToBlocks('<p onclick="x()">a<script>alert(1)</script><a href="javascript:alert(1)">b</a><img src="http://evil/x.png"></p>')
    expect(block).toMatchObject({ type: 'paragraph', html: 'aalert(1)b' })
    expect(sanitizeInline('<a href="https://ok.example/p?q=1">ok</a>')).toBe('<a href="https://ok.example/p?q=1">ok</a>')
    expect(sanitizeInline('<span style="background-color: rgba(0, 0, 0, 0)">x</span>')).toBe('x')
    expect(sanitizeInline('<span style="color: red; background-color: #FEF7E0">x</span>')).toBe('<span style="background-color:#FEF7E0">x</span>')
  })
})

describe('blocks ↔ editor HTML round trip', () => {
  const blocks: Block[] = [
    { id: 'h1', sourceId: 's1', type: 'heading', level: 1, html: 'Название' },
    { id: 'p1', sourceId: 's1', type: 'paragraph', html: 'Текст <strong>жирный</strong> и <a href="https://example.com">ссылка</a>' },
    { id: 't1', sourceId: 's1', type: 'table', header: true, rows: [['Параметр', 'Значение'], ['Цена', '499 ₽']] },
    { id: 'c1', type: 'code', language: 'js', code: 'const a = "x"\n  return a' },
    { id: 'i1', sourceId: 's2', type: 'image', src: 'snap-media://note/img.png' },
    { id: 'n1', type: 'numbered_list', start: 3, items: ['три', 'четыре'] }
  ]

  it('preserves ids, OCR source links and structure', () => {
    expect(htmlToBlocks(blocksToHtml(blocks))).toEqual(blocks)
  })

  it('normalizeBlocks re-sanitizes untrusted input', () => {
    const dirty = normalizeBlocks([
      { id: 'x', type: 'paragraph', html: '<img src=x onerror=alert(1)>hi' },
      { type: 'heading', level: 9, html: 'H' },
      { type: 'image', src: 'file:///C:/secret.png' },
      { type: 'table', rows: [['a'], ['b', 'c']] },
      { type: 'code', code: '   ' },
      'junk'
    ])
    expect(strip(dirty)).toEqual([
      { type: 'paragraph', html: 'hi' },
      { type: 'heading', level: 2, html: 'H' },
      { type: 'table', rows: [['a', ''], ['b', 'c']], header: true }
    ])
  })
})

describe('inline helpers', () => {
  it('textToInline links URLs and e-mails without changing the text', () => {
    expect(textToInline('см. https://example.com/a, пишите a.b@mail.ru')).toBe(
      'см. <a href="https://example.com/a">https://example.com/a</a>, пишите <a href="mailto:a.b@mail.ru">a.b@mail.ru</a>'
    )
    expect(textToInline('1 < 2 & "q"')).toBe('1 &lt; 2 &amp; &quot;q&quot;')
  })

  it('markUncertain wraps exact fragments once, outside tags', () => {
    expect(markUncertain('Итого 15 000 ₽', ['15 000 ₽'])).toBe('Итого <span class="ocr-uncertain">15 000 ₽</span>')
    expect(markUncertain('<a href="https://x.ru/15">15</a> 15', ['15'])).toBe('<a href="https://x.ru/15"><span class="ocr-uncertain">15</span></a> 15')
    expect(markUncertain('abc', ['zzz'])).toBe('abc')
  })
})

describe('export', () => {
  const blocks: Block[] = [
    { id: 'a', type: 'heading', level: 1, html: 'Характеристики' },
    { id: 'b', type: 'paragraph', html: 'Обычный <strong>текст</strong> с <code>a*b</code> и <a href="https://x.ru">ссылкой</a>' },
    { id: 'c', type: 'table', header: true, rows: [['Параметр', 'Значение'], ['Цена', '499 ₽'], ['A|B', 'x']] },
    { id: 'd', type: 'code', language: 'python', code: 'print("hello")' },
    { id: 'e', type: 'bullet_list', items: ['100 ГБ', 'Без рекламы'] },
    { id: 'f', type: 'checklist', items: [{ html: 'готово', done: true }] },
    { id: 'g', type: 'image', src: 'snap-media://n/i.png', alt: 'схема' }
  ]

  it('Copy for AI: clean Markdown, no Snap Notes metadata', () => {
    const md = blocksToAiMarkdown(blocks, 'Тариф')
    expect(md).toBe(
      [
        '# Тариф',
        '## Характеристики',
        'Обычный **текст** с `a*b` и [ссылкой](https://x.ru)',
        '| Параметр | Значение |\n|---|---|\n| Цена | 499 ₽ |\n| A\\|B | x |',
        '```python\nprint("hello")\n```',
        '- 100 ГБ\n- Без рекламы',
        '- [x] готово',
        '[Изображение: схема]'
      ].join('\n\n') + '\n'
    )
    expect(md).not.toMatch(/snap-media|data-block|data-src|sourceId/)
  })

  it('Markdown without a title keeps heading levels', () => {
    expect(blocksToMarkdown([blocks[0]])).toBe('# Характеристики\n')
  })

  it('code fences grow when the code contains backticks', () => {
    expect(blocksToMarkdown([{ id: 'z', type: 'code', code: 'a ``` b' }])).toBe('````\na ``` b\n````\n')
  })

  it('plain text, TSV and CSV', () => {
    expect(blocksToPlainText([blocks[4], blocks[2]])).toBe('• 100 ГБ\n• Без рекламы\n\nПараметр\tЗначение\nЦена\t499 ₽\nA|B\tx\n')
    expect(tableToTsv([['a', 'b\tc']])).toBe('a\tb c')
    expect(tableToCsv([['a,b', 'say "hi"'], ['1', '2']])).toBe('"a,b","say ""hi"""\r\n1,2')
  })

  it('rich HTML for Word: real headings, tables with borders, monospace code, resolved images', () => {
    const html = blocksToRichHtml(blocks, { resolveImage: () => 'data:image/png;base64,AAAA' })
    expect(html).toContain('<h2')
    expect(html).toContain('<th style="border:1px solid')
    expect(html).toContain('font-family:Consolas')
    expect(html).toContain('src="data:image/png;base64,AAAA"')
    expect(html).not.toContain('snap-media')
  })

  it('blocksToText for search/previews', () => {
    expect(blocksToText([blocks[0], blocks[4]])).toBe('Характеристики\n100 ГБ\nБез рекламы')
  })
})
