/**
 * Text helpers behind the editor commands: "remove unnecessary line breaks", "convert to list",
 * detection of links / e-mails / phone numbers in plain text, and note titles. Pure and DOM-free.
 */

const BULLET = /^\s*(?:[-*•·▪◦‣–—]|\[[ xX]?\]|[☐☑☒])\s+/
const NUMBERED = /^\s*(?:\d{1,3}|[a-zA-Zа-яА-Я])[.)]\s+/
const HEADING_MARK = /^#+\s*/

function isListLine(line: string): boolean {
  return BULLET.test(line) || NUMBERED.test(line)
}

function looksLikeCode(line: string): boolean {
  return (
    /^( {4,}|\t)\S/.test(line) ||
    /[{};]\s*$/.test(line) ||
    /^\s*(?:\/\/|#include|import |def |function |const |let |var |class )/.test(line)
  )
}

/**
 * Joins the hard-wrapped lines of PDF/OCR text into paragraphs. Blank lines stay paragraph breaks,
 * list items stay separate, hyphenated line ends are merged, and code-looking or table-looking
 * (tab / " | " separated, ASCII borders) lines are never joined.
 */
export function removeLineBreaks(input: string): string {
  const lines = input.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let current = ''
  const flush = (): void => {
    if (current) out.push(current)
    current = ''
  }
  for (const raw of lines) {
    const line = raw.replace(/[ \t]+$/g, '')
    if (!line.trim()) {
      flush()
      if (out.length && out[out.length - 1] !== '') out.push('')
      continue
    }
    const keepAsIs = looksLikeCode(line) || /\t| \| /.test(line) || /^[|+][-=+| ]+[|+]?$/.test(line.trim())
    if (keepAsIs) {
      flush()
      out.push(line)
      continue
    }
    const text = line.trim()
    if (isListLine(text)) {
      flush()
      current = text
      continue
    }
    if (!current) {
      current = text
    } else if (/\p{L}[-‐‑]$/u.test(current) && /^\p{Ll}/u.test(text)) {
      current = current.slice(0, -1) + text
    } else {
      current = `${current} ${text}`
    }
  }
  flush()
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Lines of selected text → clean list items (bullets, numbers and checkbox marks removed). */
export function linesToItems(text: string): { text: string; checked: boolean }[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      const checked = /^\s*(?:\[[xX]\]|☑|☒)/.test(line)
      return { text: line.replace(BULLET, '').replace(NUMBERED, '').trim(), checked }
    })
    .filter((item) => item.text)
}

// ---------------------------------------------------------------------------------------------
// links, e-mails, phone numbers

export type ContactKind = 'url' | 'email' | 'phone'

export interface Contact {
  kind: ContactKind
  value: string
  start: number
  end: number
}

const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'«»]+[^\s<>"'«»<.,;:!?)\]}]/gi
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}/g
const PHONE_RE = /(?<![\w+@./-])(?:\+\s?\d|\(?\d)[\d\s().-]{5,}\d(?![\w@])/g

/**
 * A phone number needs a realistic shape: "+" followed by 8–15 digits, or a formatted national number
 * (separators / brackets) with 10–12 digits. Bare long digit runs (card numbers, ids), dates and
 * version-like strings are not phones.
 */
export function isPlausiblePhone(raw: string): boolean {
  const value = raw.trim()
  const digits = value.replace(/\D/g, '')
  if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/.test(value) || /^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}$/.test(value)) return false
  if (/^\d+(\.\d+){2,}$/.test(value)) return false
  if (new Set(digits).size === 1) return false
  if (value.startsWith('+')) return digits.length >= 8 && digits.length <= 15
  if (!/[\s().-]/.test(value)) return false
  return digits.length >= 10 && digits.length <= 12
}

export function findContacts(text: string): Contact[] {
  const found: Contact[] = []
  const overlaps = (start: number, end: number): boolean => found.some((c) => start < c.end && end > c.start)
  const kinds: [ContactKind, RegExp][] = [
    ['url', URL_RE],
    ['email', EMAIL_RE],
    ['phone', PHONE_RE]
  ]
  for (const [kind, re] of kinds) {
    re.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) {
      const value = match[0].trim()
      const start = match.index
      const end = start + match[0].length
      if (overlaps(start, end)) continue
      if (kind === 'phone' && !isPlausiblePhone(value)) continue
      found.push({ kind, value, start, end })
    }
  }
  return found.sort((a, b) => a.start - b.start)
}

export function findContactAt(text: string, offset: number): Contact | null {
  return findContacts(text).find((c) => offset >= c.start && offset <= c.end) ?? null
}

/** Target for opening a contact with the system handler. Phones become tel:+digits. */
export function contactHref(contact: Pick<Contact, 'kind' | 'value'>): string {
  if (contact.kind === 'email') return `mailto:${contact.value}`
  if (contact.kind === 'phone') {
    const plus = contact.value.trim().startsWith('+') ? '+' : ''
    return `tel:${plus}${contact.value.replace(/\D/g, '')}`
  }
  return /^www\./i.test(contact.value) ? `https://${contact.value}` : contact.value
}

const OPENABLE = /^(https?:\/\/|mailto:|tel:)[^\s"'<>]+$/i

/** Only these schemes may be handed to the OS (never file:, javascript:, custom handlers). */
export function isOpenableLink(url: unknown): url is string {
  return typeof url === 'string' && url.length < 4000 && OPENABLE.test(url)
}

// ---------------------------------------------------------------------------------------------
// titles

/** First meaningful line of a text: skips symbol-only / very short lines, trims to a readable length. */
export function meaningfulTitle(text: string, maxLength = 60): string {
  const lines = text
    .split('\n')
    .map((l) => l.replace(BULLET, '').replace(NUMBERED, '').replace(HEADING_MARK, '').trim())
    .filter(Boolean)
  const line = lines.find((l) => (l.match(/[\p{L}\p{N}]/gu) ?? []).length >= 3) ?? lines[0] ?? ''
  if (line.length <= maxLength) return line
  const cut = line.slice(0, maxLength)
  const space = cut.lastIndexOf(' ')
  return `${cut.slice(0, space > maxLength * 0.6 ? space : maxLength).trimEnd()}…`
}
