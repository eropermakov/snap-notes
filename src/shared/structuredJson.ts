/**
 * Tolerant extraction of the block list from an AI response. Models are asked for
 * {"blocks":[...]} but may return a bare array, wrap it in ``` fences, prepend <think> reasoning,
 * leave trailing commas or stop mid-way. This never throws: it returns null when nothing usable
 * could be recovered, and the caller decides what to do (retry once, then plain-text fallback).
 */

function stripNoise(raw: string): string {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i)
  if (fence && fence[1].trim()) text = fence[1].trim()
  return text
}

function removeTrailingCommas(text: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === ',') {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j])) j++
      if (text[j] === '}' || text[j] === ']') continue
    }
    out += ch
  }
  return out
}

/**
 * Closes a JSON document that was cut off: drops the unfinished trailing element and closes every
 * open bracket. Returns null if the text is not a JSON container at all.
 */
function closeTruncated(text: string): string | null {
  const stack: string[] = []
  let inString = false
  let escaped = false
  // Position after the last complete value at depth >= 1 (a safe cut point).
  let lastSafe = -1
  let safeStack: string[] = []
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']')
    else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return null
      if (stack.length === 0) return text.slice(0, i + 1)
      lastSafe = i + 1
      safeStack = [...stack]
    }
  }
  if (stack.length === 0) return null
  if (lastSafe === -1) return null
  const cut = text.slice(0, lastSafe).replace(/,\s*$/, '')
  return cut + safeStack.reverse().join('')
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function extractItems(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') {
    const blocks = (value as Record<string, unknown>).blocks
    if (Array.isArray(blocks)) return blocks
  }
  return null
}

/** Returns the raw block items, or null when the response holds no recoverable JSON. */
export function extractBlockItems(raw: string): unknown[] | null {
  if (!raw || !raw.trim()) return null
  const text = stripNoise(raw)
  const objectStart = text.indexOf('{')
  const arrayStart = text.indexOf('[')
  const starts = [objectStart, arrayStart].filter((i) => i !== -1).sort((a, b) => a - b)
  for (const start of starts) {
    const candidate = text.slice(start)
    const closer = candidate[0] === '{' ? '}' : ']'
    const end = candidate.lastIndexOf(closer)
    const attempts = [
      end !== -1 ? candidate.slice(0, end + 1) : null,
      end !== -1 ? removeTrailingCommas(candidate.slice(0, end + 1)) : null,
      closeTruncated(removeTrailingCommas(candidate))
    ]
    for (const attempt of attempts) {
      if (!attempt) continue
      const items = extractItems(tryParse(attempt))
      if (items) return items
    }
  }
  return null
}

/** True when the response is plainly not JSON (so a "return valid JSON" retry is worth one request). */
export function looksLikeJsonAttempt(raw: string): boolean {
  const text = stripNoise(raw)
  return /^[[{]/.test(text) || /"type"\s*:/.test(text)
}
