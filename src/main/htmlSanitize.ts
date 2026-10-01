import sanitizeHtml from 'sanitize-html'

const ALLOWED_COLORS = /^(#[0-9a-fA-F]{3,8}|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[0-9.]+\s*\))$/

/** Block ids and OCR source links (see src/shared/blocks.ts) — must survive editor round trips. */
const BLOCK_ATTRS = ['data-block', 'data-src']

export function sanitizeNoteHtml(html: string): string {
  if (!html) return ''
  return sanitizeHtml(html, {
    allowedTags: [
      'p',
      'br',
      'b',
      'strong',
      'i',
      'em',
      'u',
      's',
      'strike',
      'del',
      'mark',
      'sub',
      'sup',
      'code',
      'pre',
      'blockquote',
      'a',
      'span',
      'div',
      'h1',
      'h2',
      'h3',
      'h4',
      'ul',
      'ol',
      'li',
      'table',
      'thead',
      'tbody',
      'tr',
      'td',
      'th',
      'img'
    ],
    allowedAttributes: {
      span: ['style', 'class', 'data-conf', 'data-bbox'],
      p: ['class', ...BLOCK_ATTRS],
      div: BLOCK_ATTRS,
      h1: BLOCK_ATTRS,
      h2: BLOCK_ATTRS,
      h3: BLOCK_ATTRS,
      h4: BLOCK_ATTRS,
      blockquote: BLOCK_ATTRS,
      pre: ['data-lang', ...BLOCK_ATTRS],
      ul: ['class', ...BLOCK_ATTRS],
      ol: ['start', ...BLOCK_ATTRS],
      li: ['class'],
      table: BLOCK_ATTRS,
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
      img: ['src', 'class', 'alt', ...BLOCK_ATTRS],
      a: ['href']
    },
    allowedClasses: {
      span: ['ui-chip', 'ocr-uncertain'],
      p: ['ocr-flag'],
      ul: ['todo-list'],
      li: ['todo-item', 'done'],
      img: ['doc-image']
    },
    allowedStyles: {
      span: {
        color: [ALLOWED_COLORS],
        'background-color': [ALLOWED_COLORS]
      }
    },
    disallowedTagsMode: 'discard',
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: {
      img: ['snap-media'],
      a: ['http', 'https', 'mailto', 'tel']
    },
    allowProtocolRelative: false
  })
}
