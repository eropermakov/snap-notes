/**
 * Deterministic OCR cleanup (§4). Conservative by design: it fixes spacing and layout artifacts but
 * never rephrases, never touches digits inside numbers and is never applied to code blocks.
 * Anything that needs judgement (split letters, misread characters) is left to the AI "fix OCR" step.
 */

const INVISIBLE = /[​-‍⁠﻿­]/g

/** Cleans one text fragment (paragraph, list item, table cell). Newlines the source kept are kept. */
export function cleanOcrText(input: string): string {
  if (!input) return ''
  let text = input.replace(/\r\n?/g, '\n').replace(INVISIBLE, '').replace(/\t/g, ' ')
  // Word split by a line-end hyphen: "распозна-\nвание" → "распознавание".
  text = text.replace(/(\p{L})[-‐‑]\n(\p{Ll})/gu, '$1$2')
  text = text
    .split('\n')
    .map((line) =>
      line
        .replace(/ {2,}/g, ' ')
        // No space before closing punctuation ("слово ," → "слово,"), but keep ".5" / "…" in numbers intact.
        .replace(/ +([,;:!?»)\]}])/g, '$1')
        .replace(/ +\.(?=\s|$)/g, '.')
        // No space after opening brackets/quotes ("( текст" → "(текст").
        .replace(/([(«[{]) +/g, '$1')
        .trim()
    )
    .join('\n')
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

/** True for lines that are pure OCR noise: stray bars, dots, single symbols. */
export function isJunkLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return true
  if (/[\p{L}\p{N}]/u.test(trimmed)) return false
  // Keep lone list bullets / dashes only when they carry text (handled by callers); pure symbols go.
  return trimmed.length <= 4
}

/** Joins the lines of one paragraph: hyphenated breaks are merged, other breaks become spaces. */
export function joinParagraphLines(lines: string[]): string {
  let out = ''
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (!out) {
      out = line
    } else if (/\p{L}[-‐‑]$/u.test(out) && /^\p{Ll}/u.test(line)) {
      out = out.slice(0, -1) + line
    } else {
      out = `${out} ${line}`
    }
  }
  return cleanOcrText(out)
}
