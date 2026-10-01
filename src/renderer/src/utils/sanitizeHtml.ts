const ALLOWED_TAGS = new Set([
  'P',
  'BR',
  'B',
  'STRONG',
  'I',
  'EM',
  'U',
  'S',
  'STRIKE',
  'DEL',
  'MARK',
  'SUB',
  'SUP',
  'CODE',
  'PRE',
  'BLOCKQUOTE',
  'A',
  'SPAN',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'UL',
  'OL',
  'LI',
  'TABLE',
  'THEAD',
  'TBODY',
  'TR',
  'TD',
  'TH',
  'IMG'
])

const ALLOWED_STYLE_PROPS = new Set(['color', 'background-color'])
const SAFE_COLOR = /^(#[0-9a-fA-F]{3,8}|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[0-9.]+\s*\)|transparent)$/
const SAFE_IMG_SRC = /^snap-media:\/\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+\.png$/
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:)[^\s"'<>]+$/i
const SAFE_ID = /^[a-zA-Z0-9_-]{1,64}$/

const ALLOWED_CLASSES: Record<string, Set<string>> = {
  SPAN: new Set(['ui-chip', 'ocr-uncertain']),
  P: new Set(['ocr-flag']),
  UL: new Set(['todo-list']),
  LI: new Set(['todo-item', 'done']),
  IMG: new Set(['doc-image'])
}

/** Block ids / OCR source links (src/shared/blocks.ts); kept so they survive editing. */
const BLOCK_ATTR_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'PRE', 'UL', 'OL', 'TABLE', 'IMG'])

function keepAttribute(el: Element, name: string, value: string): boolean {
  const tag = el.tagName
  if ((name === 'data-block' || name === 'data-src') && BLOCK_ATTR_TAGS.has(tag)) return SAFE_ID.test(value)
  if ((name === 'colspan' || name === 'rowspan') && (tag === 'TD' || tag === 'TH')) return /^\d{1,2}$/.test(value)
  if (name === 'alt' && tag === 'IMG') return true
  if (name === 'data-lang' && tag === 'PRE') return /^[a-z0-9+#._-]{0,32}$/i.test(value)
  if (name === 'start' && tag === 'OL') return /^\d{1,5}$/.test(value)
  if (name === 'data-conf' && tag === 'SPAN') return /^(0(\.\d+)?|1(\.0+)?)$/.test(value)
  if (name === 'data-bbox' && tag === 'SPAN') return /^\d+(\.\d+)?(,\d+(\.\d+)?){3}$/.test(value)
  return false
}

function cleanElement(el: Element): void {
  if (!ALLOWED_TAGS.has(el.tagName)) {
    const parent = el.parentNode
    if (parent) {
      const children = Array.from(el.children)
      while (el.firstChild) parent.insertBefore(el.firstChild, el)
      parent.removeChild(el)
      for (const child of children) cleanElement(child)
    }
    return
  }

  for (const attr of Array.from(el.attributes)) {
    if (attr.name === 'style' && (el.tagName === 'SPAN' || el.tagName === 'DIV')) {
      const kept: string[] = []
      for (const decl of attr.value.split(';')) {
        const [prop, value] = decl.split(':').map((s) => s.trim())
        if (prop && value && ALLOWED_STYLE_PROPS.has(prop.toLowerCase()) && SAFE_COLOR.test(value)) {
          kept.push(`${prop}:${value}`)
        }
      }
      if (kept.length > 0) {
        el.setAttribute('style', kept.join(';'))
      } else {
        el.removeAttribute('style')
      }
    } else if (attr.name === 'src' && el.tagName === 'IMG') {
      if (!SAFE_IMG_SRC.test(attr.value)) el.removeAttribute('src')
    } else if (attr.name === 'href' && el.tagName === 'A') {
      if (!SAFE_HREF.test(attr.value.trim())) el.removeAttribute('href')
    } else if (attr.name === 'class') {
      const allowed = ALLOWED_CLASSES[el.tagName]
      const kept = attr.value.split(/\s+/).filter((c) => allowed?.has(c))
      if (kept.length > 0) {
        el.setAttribute('class', kept.join(' '))
      } else {
        el.removeAttribute('class')
      }
    } else if (!keepAttribute(el, attr.name, attr.value)) {
      el.removeAttribute(attr.name)
    }
  }

  for (const child of Array.from(el.children)) {
    cleanElement(child)
  }
}

export function sanitizeHtmlForDisplay(html: string): string {
  if (!html) return ''
  const parser = new DOMParser()
  const doc = parser.parseFromString(`<div id="root">${html}</div>`, 'text/html')
  const root = doc.getElementById('root')
  if (!root) return ''
  for (const child of Array.from(root.children)) {
    cleanElement(child)
  }
  return root.innerHTML
}
