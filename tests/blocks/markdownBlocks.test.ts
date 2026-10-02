import { describe, expect, it } from 'vitest'
import { markdownToBlockJson, markdownToItems, stripInlineMarkdown } from '../../src/shared/markdownBlocks'
import { extractBlockItems } from '../../src/shared/structuredJson'
import { itemsToBlocks } from '../../src/shared/aiBlocks'
import { blocksToText } from '../../src/shared/blocks'
import { buildEnvFile } from '../../src/main/providers/credentialExport'

describe('markdownToItems (OCR engine output → note blocks)', () => {
  it('headings, paragraphs (soft-wrapped lines joined), quotes', () => {
    const items = markdownToItems('# Title\n\nFirst line\nsecond line.\n\n### Sub\n\n> quoted\n> text')
    expect(items).toEqual([
      { type: 'heading', level: 1, text: 'Title' },
      { type: 'paragraph', text: 'First line second line.' },
      { type: 'heading', level: 3, text: 'Sub' },
      { type: 'quote', text: 'quoted text' }
    ])
  })

  it('pipe tables keep header and cells', () => {
    const [table] = markdownToItems('| Name | Price |\n|:--|--:|\n| Bread | 50 |\n| Milk | 80 |')
    expect(table).toEqual({ type: 'table', header: true, rows: [['Name', 'Price'], ['Bread', '50'], ['Milk', '80']] })
  })

  it('HTML tables (what OCR engines return for complex tables)', () => {
    const [table] = markdownToItems('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2 &amp; 3</td></tr></table>')
    expect(table).toEqual({ type: 'table', header: true, rows: [['A', 'B'], ['1', '2 & 3']] })
  })

  it('lists: bullets, numbered (with start), checklists', () => {
    const items = markdownToItems('- a\n- b\n\n3. x\n4. y\n\n- [x] done\n- [ ] todo')
    expect(items).toEqual([
      { type: 'bullet_list', items: ['a', 'b'] },
      { type: 'numbered_list', start: 3, items: ['x', 'y'] },
      { type: 'checklist', items: [{ text: 'done', done: true }, { text: 'todo', done: false }] }
    ])
  })

  it('code fences are copied verbatim, including markdown-looking content', () => {
    const [code] = markdownToItems('```python\ndef f():\n    return "**not bold**"  # | pipe\n```')
    expect(code).toEqual({ type: 'code', language: 'python', code: 'def f():\n    return "**not bold**"  # | pipe' })
  })

  it('drops image references, strips inline formatting, keeps link targets', () => {
    expect(markdownToItems('![img-0.jpeg](img-0.jpeg)\n\n**Bold** and `code` see [docs](https://a.b/c).')).toEqual([
      { type: 'paragraph', text: 'Bold and code see docs (https://a.b/c).' }
    ])
    expect(stripInlineMarkdown('[https://a.b](https://a.b)')).toBe('https://a.b')
  })

  it('empty input gives an empty, valid block list', () => {
    expect(markdownToItems('  \n\n')).toEqual([])
    expect(extractBlockItems(markdownToBlockJson(''))).toEqual([])
  })

  it('end to end: Markdown → JSON → validated blocks with content preserved', () => {
    const json = markdownToBlockJson('## Счёт\n\n| № | Сумма |\n|---|---|\n| 1 | 1 200,50 |')
    const blocks = itemsToBlocks(extractBlockItems(json) as unknown[], 's1')
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'table'])
    expect(blocksToText(blocks as never)).toContain('1 200,50')
  })
})

describe('Export API keys (.env text)', () => {
  const fixed = new Date('2026-10-02T00:00:00Z')

  it('writes one NAME=value line per credential, with a warning header', () => {
    const text = buildEnvFile(
      [
        { env: 'GEMINI_API_KEY', value: 'AIzaSy-test_123' },
        { env: 'CLOUDFLARE_ACCOUNT_ID', value: 'abc123' },
        { env: 'MODAL_OCR_ENDPOINT', value: 'https://ws--app.modal.run' }
      ],
      fixed
    )
    expect(text).toContain('WARNING: this file contains secret API credentials')
    expect(text).toContain('\nGEMINI_API_KEY=AIzaSy-test_123\n')
    expect(text).toContain('\nCLOUDFLARE_ACCOUNT_ID=abc123\n')
    expect(text).toContain('\nMODAL_OCR_ENDPOINT=https://ws--app.modal.run\n')
  })

  it('a value can never inject another line or variable', () => {
    const text = buildEnvFile([{ env: 'GROQ_API_KEY', value: 'gsk_x\nOPENAI_API_KEY=evil' }], fixed)
    expect(text.split('\n').filter((l) => l.startsWith('OPENAI_API_KEY'))).toEqual([])
    expect(text).toContain('GROQ_API_KEY=gsk_xOPENAI_API_KEY=evil')
  })

  it('quotes values with spaces or hashes; skips invalid names and empty values', () => {
    const text = buildEnvFile([{ env: 'A_B', value: 'has space #x' }, { env: 'bad name', value: 'v' }, { env: 'EMPTY', value: '  ' }], fixed)
    expect(text).toContain('A_B="has space #x"')
    expect(text).not.toContain('bad name')
    expect(text).not.toContain('EMPTY=')
  })
})
