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
  'SPAN',
  'DIV',
  'H3',
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

const ALLOWED_CLASSES: Record<string, Set<string>> = {
  SPAN: new Set(['ui-chip']),
  P: new Set(['ocr-flag']),
  UL: new Set(['todo-list']),
  LI: new Set(['todo-item', 'done']),
  IMG: new Set(['doc-image'])
}

function cleanElement(el: Element): void {
  if (!ALLOWED_TAGS.has(el.tagName)) {
    const parent = el.parentNode
    if (parent) {
      while (el.firstChild) parent.insertBefore(el.firstChild, el)
      parent.removeChild(el)
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
    } else if ((attr.name === 'colspan' || attr.name === 'rowspan') && (el.tagName === 'TD' || el.tagName === 'TH')) {
      // keep
    } else if (attr.name === 'src' && el.tagName === 'IMG') {
      if (!SAFE_IMG_SRC.test(attr.value)) el.removeAttribute('src')
    } else if (attr.name === 'alt' && el.tagName === 'IMG') {
      // keep
    } else if (attr.name === 'class') {
      const allowed = ALLOWED_CLASSES[el.tagName]
      const kept = attr.value.split(/\s+/).filter((c) => allowed?.has(c))
      if (kept.length > 0) {
        el.setAttribute('class', kept.join(' '))
      } else {
        el.removeAttribute('class')
      }
    } else {
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
