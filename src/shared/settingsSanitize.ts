import type { AppSettings, CardSize, OcrFeedback } from './types'
import { normalizeSortOrder } from './noteList'

export const FONT_SIZE_MIN = 12
export const FONT_SIZE_MAX = 24

/** Editor fonts offered in settings (only installed ones are shown). '' = the app default. */
export const EDITOR_FONTS = ['Segoe UI', 'Arial', 'Calibri', 'Cambria', 'Georgia', 'Times New Roman', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Consolas'] as const

/** Local font assets shipped with the app, with Cyrillic and Latin glyphs. */
export const BUNDLED_EDITOR_FONTS = ['Montserrat', 'Manrope', 'Inter', 'Open Sans', 'Roboto', 'Nunito Sans', 'Rubik', 'Onest', 'Source Sans 3', 'Noto Sans', 'Lora', 'Noto Serif'] as const

export function clampFontSize(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 14
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(n)))
}

/** A font name is data that ends up in CSS: only plain family names are accepted. */
export function sanitizeFontFamily(value: unknown): string {
  if (typeof value !== 'string') return ''
  const name = value.trim()
  return /^[\p{L}\p{N} ._-]{1,60}$/u.test(name) ? name : ''
}

const CARD_SIZES: CardSize[] = ['small', 'medium', 'large']
const FEEDBACK: OcrFeedback[] = ['none', 'visual', 'sound']
const SAFE_ID = /^[a-zA-Z0-9_-]{1,64}$/

/**
 * Validates the view / editor / behaviour settings coming from the renderer. Unknown keys of this
 * group are dropped and internal window state can never be written from the renderer.
 */
export function sanitizeUiSettings(patch: Partial<AppSettings>): Partial<AppSettings> {
  const out: Partial<AppSettings> = { ...patch }
  delete out.windowState
  delete out.floatingState
  delete out.quickNoteState
  delete out.floatingOnTop
  if ('sortOrder' in out) out.sortOrder = normalizeSortOrder(out.sortOrder)
  if ('cardSize' in out && !CARD_SIZES.includes(out.cardSize as CardSize)) out.cardSize = 'medium'
  if ('ocrFeedback' in out && !FEEDBACK.includes(out.ocrFeedback as OcrFeedback)) out.ocrFeedback = 'visual'
  if ('ocrMaxConcurrent' in out) out.ocrMaxConcurrent = Math.min(3, Math.max(1, Math.round(Number(out.ocrMaxConcurrent)) || 1))
  if ('editorFontSize' in out) out.editorFontSize = clampFontSize(out.editorFontSize)
  if ('editorFontFamily' in out) out.editorFontFamily = sanitizeFontFamily(out.editorFontFamily)
  if ('lastNoteId' in out) out.lastNoteId = typeof out.lastNoteId === 'string' && SAFE_ID.test(out.lastNoteId) ? out.lastNoteId : null
  for (const key of ['compactGrid', 'autoCollapseSidebar', 'restoreLastNote', 'suggestClipboardOcr', 'ocrQueueEnabled', 'ocrTrimRepeats'] as const) {
    if (key in out) out[key] = out[key] === true
  }
  return out
}
