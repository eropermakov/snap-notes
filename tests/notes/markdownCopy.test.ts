import { describe, expect, it } from 'vitest'
import { htmlToBlocks } from '../../src/shared/blocks'
import { blocksToAiMarkdown, blocksToMarkdown, blocksToPlainText } from '../../src/shared/blockExport'

/** "Copy as Markdown" is what people paste into Claude / ChatGPT: every block type must survive. */
const NOTE_HTML = [
  '<h1>Заголовок</h1>',
  '<p>Обычный <strong>абзац</strong> со <a href="https://example.com/a">ссылкой</a>.</p>',
  '<ul><li>раз</li><li>два</li></ul>',
  '<ol><li>первый</li><li>второй</li></ol>',
  '<ul class="todo-list"><li class="todo-item done">сделано</li><li class="todo-item">в планах</li></ul>',
  '<table><thead><tr><th>Имя</th><th>Цена</th></tr></thead><tbody><tr><td>Хлеб</td><td>40</td></tr></tbody></table>',
  '<pre data-lang="js"><code>const a = 1\nconsole.log(a)</code></pre>',
  '<p><img class="doc-image" src="snap-media://n1/pic.png" alt="схема"></p>'
].join('')

describe('copy as Markdown', () => {
  const md = blocksToAiMarkdown(htmlToBlocks(NOTE_HTML), 'Моя заметка')

  it('converts headings, paragraphs and links', () => {
    expect(md).toContain('# Моя заметка')
    expect(md).toContain('## Заголовок')
    expect(md).toContain('Обычный **абзац** со [ссылкой](https://example.com/a).')
  })

  it('converts bullet, numbered and checkbox lists', () => {
    expect(md).toContain('- раз\n- два')
    expect(md).toContain('1. первый\n2. второй')
    expect(md).toContain('- [x] сделано\n- [ ] в планах')
  })

  it('converts a table to a Markdown table', () => {
    expect(md).toContain('| Имя | Цена |\n|---|---|\n| Хлеб | 40 |')
  })

  it('wraps code in a fenced block with its language', () => {
    expect(md).toContain('```js\nconst a = 1\nconsole.log(a)\n```')
  })

  it('refers to images by a placeholder (a chat cannot open local files) and exposes no internal data', () => {
    expect(md).toContain('[Изображение: схема]')
    expect(md).not.toMatch(/snap-media|data-block|data-src|sourceId/)
  })

  it('the plain-text copy has no markup and no metadata either', () => {
    const plain = blocksToPlainText(htmlToBlocks(NOTE_HTML), 'Моя заметка')
    expect(plain).not.toMatch(/<|data-|snap-media/)
    expect(plain).toContain('Хлеб')
    expect(plain).toContain('const a = 1')
  })

  it('keeps the file-export variant able to reference real image files', () => {
    const out = blocksToMarkdown(htmlToBlocks(NOTE_HTML), { image: (_src, alt) => `![${alt}](pic_files/image-1.png)` })
    expect(out).toContain('![схема](pic_files/image-1.png)')
  })
})
