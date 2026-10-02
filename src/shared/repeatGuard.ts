/**
 * Repeat guard for recognized text. Two different things produce "the same text again" in a note:
 *
 *  1. A runaway answer. Vision models sometimes get stuck on technical screens (logs, status tables, config
 *     dumps) and repeat one line or a short cycle of lines until the answer is cut off. `collapseRunaway`
 *     removes only loops that are far beyond anything a real screen shows (a handful of identical lines is
 *     kept: "Status: OK" four times is legitimate content).
 *  2. Overlapping captures. Capturing a long page piece by piece leaves the same lines at the end of one
 *     capture and the start of the next. `trimOverlap` drops that exact overlap from the new capture.
 *
 * Both only ever remove text that is an exact (whitespace/case-insensitive) copy of text that stays in the
 * note, and the original screenshot is always kept, so nothing is lost for good.
 */
import { blocksToText, type Block } from './blocks'

/** Identical neighbouring paragraphs / list items / table rows before it counts as a loop. */
const MAX_BLOCK_RUN = 6
const MAX_ROW_RUN = 8
const MAX_CODE_LINE_RUN = 10
/** A cycle of 2–4 blocks repeated this many times in a row is a loop. */
const MIN_CYCLE_REPEATS = 4
const MAX_CYCLE_PERIOD = 4
const MAX_REGEX_TEXT = 20_000

export interface GuardResult {
  blocks: Block[]
  /** Blocks / lines / rows that were removed as repeats. */
  removed: number
}

const norm = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim()
const meaningful = (text: string, min: number): boolean => text.length >= min && /[\p{L}\p{N}]/u.test(text)

function key(block: Block): string {
  if (block.type === 'image') return `image:${block.src}`
  return `${block.type}:${norm(blocksToText([block]))}`
}

/** Collapses runs of identical entries, keeping one. `limit` is the longest run that is kept as it is. */
function collapseRuns<T>(items: T[], limit: number, same: (a: T, b: T) => boolean, worth: (item: T) => boolean): { items: T[]; removed: number } {
  const out: T[] = []
  let removed = 0
  let i = 0
  while (i < items.length) {
    let j = i + 1
    while (j < items.length && same(items[i], items[j])) j++
    const run = j - i
    if (run > limit && worth(items[i])) {
      out.push(items[i])
      removed += run - 1
    } else {
      out.push(...items.slice(i, j))
    }
    i = j
  }
  return { items: out, removed }
}

/** A short cycle of blocks repeated many times in a row (A B A B A B A B …) keeps its first cycle. */
function collapseCycles(blocks: Block[]): { blocks: Block[]; removed: number } {
  const keys = blocks.map(key)
  const out: Block[] = []
  let removed = 0
  let i = 0
  while (i < blocks.length) {
    let collapsed = false
    for (let period = 2; period <= MAX_CYCLE_PERIOD && !collapsed; period++) {
      if (i + period * MIN_CYCLE_REPEATS > blocks.length) break
      const cycle = keys.slice(i, i + period)
      if (!cycle.some((k) => meaningful(k.slice(k.indexOf(':') + 1), 4))) continue
      let repeats = 1
      while (i + (repeats + 1) * period <= blocks.length && cycle.every((k, n) => keys[i + repeats * period + n] === k)) repeats++
      if (repeats >= MIN_CYCLE_REPEATS) {
        out.push(...blocks.slice(i, i + period))
        removed += (repeats - 1) * period
        i += repeats * period
        collapsed = true
      }
    }
    if (!collapsed) {
      out.push(blocks[i])
      i++
    }
  }
  return { blocks: out, removed }
}

/** One phrase repeated again and again inside a single paragraph ("… error … error … error …"). */
function collapsePhrase(html: string): string {
  if (html.length > MAX_REGEX_TEXT) return html
  return html.replace(/(.{12,300}?)(?:\s*\1){5,}/gs, '$1')
}

/** Removes runaway repetition from one recognition result. */
export function collapseRunaway(blocks: Block[]): GuardResult {
  let removed = 0
  const cleaned: Block[] = blocks.map((block) => {
    switch (block.type) {
      case 'table': {
        const rows = collapseRuns(block.rows, MAX_ROW_RUN, (a, b) => norm(a.join('|')) === norm(b.join('|')), (row) => meaningful(norm(row.join(' ')), 4))
        removed += rows.removed
        return rows.removed ? { ...block, rows: rows.items } : block
      }
      case 'bullet_list':
      case 'numbered_list': {
        const items = collapseRuns(block.items, MAX_BLOCK_RUN, (a, b) => norm(a) === norm(b), (item) => meaningful(norm(item), 4))
        removed += items.removed
        return items.removed ? { ...block, items: items.items } : block
      }
      case 'code': {
        const lines = collapseRuns(block.code.split('\n'), MAX_CODE_LINE_RUN, (a, b) => norm(a) === norm(b), (line) => meaningful(norm(line), 6))
        removed += lines.removed
        return lines.removed ? { ...block, code: lines.items.join('\n') } : block
      }
      case 'paragraph':
      case 'quote': {
        const html = collapsePhrase(block.html)
        if (html === block.html) return block
        removed += 1
        return { ...block, html }
      }
      default:
        return block
    }
  })

  const runs = collapseRuns(cleaned, MAX_BLOCK_RUN, (a, b) => key(a) === key(b), (block) => block.type !== 'image' && meaningful(norm(blocksToText([block])), 4))
  removed += runs.removed
  const cycles = collapseCycles(runs.items)
  removed += cycles.removed
  return { blocks: cycles.blocks, removed }
}

/** Longest prefix of `a` that is also a suffix of `b`, as a list of candidates (longest first). */
function borders(a: string, b: string): number[] {
  const s = `${a}\n${b}`
  const pi = new Array<number>(s.length).fill(0)
  for (let i = 1; i < s.length; i++) {
    let k = pi[i - 1]
    while (k > 0 && s[i] !== s[k]) k = pi[k - 1]
    if (s[i] === s[k]) k++
    pi[i] = k
  }
  const out: number[] = []
  let k = pi[s.length - 1]
  while (k > 0) {
    if (k <= a.length) out.push(k)
    k = pi[k - 1]
  }
  return out
}

const MIN_OVERLAP_CHARS = 24
const MIN_OVERLAP_WORDS = 4
const HEAD_TAIL_LIMIT = 4000

/**
 * Drops from the start of `next` the text the capture before it already ended with. The comparison is on the
 * text (not on blocks) because the same lines come back grouped differently: Tesseract joins neighbouring
 * lines into one paragraph, AI answers split them again. `previousTail` are the last blocks of the note; only
 * the unbroken run of capture blocks at its end counts, so text the user typed in between is never compared.
 * A capture that is entirely a copy of the previous one is kept: that was a deliberate second capture.
 */
export function trimOverlap(previousTail: Block[], next: Block[]): GuardResult {
  let start = previousTail.length
  while (start > 0 && previousTail[start - 1].sourceId && previousTail[start - 1].type !== 'image') start--
  const prev = previousTail.slice(start)
  if (prev.length === 0 || next.length === 0) return { blocks: next, removed: 0 }

  const prevText = norm(blocksToText(prev)).slice(-HEAD_TAIL_LIMIT)
  const nextTexts = next.map((b) => norm(blockTextOf(b)))
  const nextText = nextTexts.filter(Boolean).join(' ').slice(0, HEAD_TAIL_LIMIT)
  if (!prevText || !nextText) return { blocks: next, removed: 0 }

  for (const length of borders(nextText, prevText)) {
    // Whole words only, and enough text for it to be an overlap rather than a coincidence.
    if (length < MIN_OVERLAP_CHARS || nextText.slice(0, length).split(' ').length < MIN_OVERLAP_WORDS) continue
    if (length < nextText.length && nextText[length] !== ' ') continue
    if (length < prevText.length && prevText[prevText.length - length - 1] !== ' ') continue
    if (length >= nextText.length) return { blocks: next, removed: 0 }
    const trimmed = dropLeadingText(next, nextTexts, length)
    if (trimmed) return trimmed
  }
  return { blocks: next, removed: 0 }
}

const blockTextOf = (block: Block): string => (block.type === 'image' ? '' : blocksToText([block]))

/** Removes the first `length` normalized characters: whole blocks, and the start of a plain paragraph. */
function dropLeadingText(blocks: Block[], texts: string[], length: number): GuardResult | null {
  let consumed = 0
  let index = 0
  while (index < blocks.length && consumed + texts[index].length <= length) {
    if (texts[index]) consumed += texts[index].length + 1
    index++
  }
  const rest = blocks.slice(index)
  let removed = index
  const covered = length - consumed
  if (covered > 0) {
    const block = rest[0]
    // Only a paragraph without markup can be cut in the middle without risking its formatting.
    if (!block || block.type !== 'paragraph' || /[<&]/.test(block.html)) return null
    const words = block.html.split(/\s+/).filter(Boolean)
    let skipped = 0
    let taken = 0
    while (taken < words.length && skipped < covered) skipped += words[taken++].length + 1
    if (skipped < covered) return null
    rest[0] = { ...block, html: words.slice(taken).join(' ') }
    removed += 1
  }
  if (rest.length === 0 || (rest.length === 1 && rest[0].type === 'paragraph' && !rest[0].html.trim())) return null
  return { blocks: rest, removed }
}
