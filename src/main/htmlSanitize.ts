import sanitizeHtml from 'sanitize-html'

const ALLOWED_COLORS = /^(#[0-9a-fA-F]{3,8}|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[0-9.]+\s*\))$/

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
      'span',
      'div',
      'h3',
      'ul',
      'ol',
      'li',
      'table',
      'thead',
      'tbody',
      'tr',
      'td',
      'th'
    ],
    allowedAttributes: {
      span: ['style', 'class'],
      p: ['class'],
      ul: ['class'],
      li: ['class'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan']
    },
    allowedClasses: {
      span: ['ui-chip'],
      p: ['ocr-flag'],
      ul: ['todo-list'],
      li: ['todo-item', 'done']
    },
    allowedStyles: {
      span: {
        color: [ALLOWED_COLORS],
        'background-color': [ALLOWED_COLORS]
      }
    },
    disallowedTagsMode: 'discard',
    allowedSchemes: []
  })
}
