import { globalShortcut } from 'electron'
import { HotkeyConfig, HotkeyKind, HotkeyRegistrationResult, OPTIONAL_HOTKEYS } from '../shared/types'

export type HotkeyHandlers = Record<HotkeyKind, () => void>

export const HOTKEY_KINDS: HotkeyKind[] = [
  'region',
  'fullscreen',
  'document',
  'longScreenshot',
  'copyForAi',
  'openApp',
  'session',
  'quickNote',
  'repeatCapture',
  'ocrClipboard',
  'globalSearch'
]

const LABELS: Record<HotkeyKind, string> = {
  region: 'захват в заметку',
  fullscreen: 'весь экран',
  document: 'захват в новую заметку',
  longScreenshot: 'прокручиваемый захват',
  copyForAi: 'скопировать для AI',
  openApp: 'открыть Snap Notes',
  session: 'сессия захвата',
  quickNote: 'быстрая заметка',
  repeatCapture: 'повторить захват',
  ocrClipboard: 'распознать картинку из буфера',
  globalSearch: 'поиск по заметкам'
}

/**
 * Registers all global hotkeys. Detects duplicates between our own hotkeys and combinations already
 * taken by another app (Windows refuses the registration). Optional hotkeys may be empty (off).
 */
export function registerHotkeys(hotkeys: HotkeyConfig, handlers: HotkeyHandlers): HotkeyRegistrationResult {
  globalShortcut.unregisterAll()

  const result = Object.fromEntries(HOTKEY_KINDS.map((k) => [k, { ok: false }])) as HotkeyRegistrationResult
  const value = (kind: HotkeyKind): string => (hotkeys[kind] ?? '').trim()

  for (const kind of HOTKEY_KINDS) {
    if (!value(kind)) {
      result[kind] = OPTIONAL_HOTKEYS.includes(kind) ? { ok: true } : { ok: false, error: 'Комбинация не указана' }
    }
  }

  for (let i = 0; i < HOTKEY_KINDS.length; i++) {
    for (let j = i + 1; j < HOTKEY_KINDS.length; j++) {
      const a = HOTKEY_KINDS[i]
      const b = HOTKEY_KINDS[j]
      if (!value(a) || !value(b) || result[a].error || result[b].error) continue
      if (value(a).toLowerCase() === value(b).toLowerCase()) {
        result[a] = { ok: false, error: `Совпадает с хоткеем «${LABELS[b]}»` }
        result[b] = { ok: false, error: `Совпадает с хоткеем «${LABELS[a]}»` }
      }
    }
  }

  for (const kind of HOTKEY_KINDS) {
    if (!value(kind) || result[kind].error) continue
    try {
      const ok = globalShortcut.register(value(kind), handlers[kind])
      result[kind] = ok
        ? { ok: true }
        : { ok: false, error: 'Не удалось зарегистрировать — комбинация уже занята другим приложением' }
    } catch (err) {
      result[kind] = { ok: false, error: (err as Error).message || 'Некорректная комбинация клавиш' }
    }
  }

  return result
}

export function unregisterAllHotkeys(): void {
  globalShortcut.unregisterAll()
}
