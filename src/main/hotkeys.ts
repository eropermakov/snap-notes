import { globalShortcut } from 'electron'
import { HotkeyConfig, HotkeyRegistrationResult } from '../shared/types'

export interface HotkeyHandlers {
  onRegion: () => void
  onFullscreen: () => void
  onDocument: () => void
}

type HotkeyKind = 'region' | 'fullscreen' | 'document'

const KINDS: HotkeyKind[] = ['region', 'fullscreen', 'document']

const LABELS: Record<HotkeyKind, string> = {
  region: 'область экрана',
  fullscreen: 'весь экран',
  document: 'документ из скриншота'
}

export function registerHotkeys(hotkeys: HotkeyConfig, handlers: HotkeyHandlers): HotkeyRegistrationResult {
  globalShortcut.unregisterAll()

  const result: HotkeyRegistrationResult = {
    region: { ok: false },
    fullscreen: { ok: false },
    document: { ok: false }
  }

  for (const kind of KINDS) {
    if (!hotkeys[kind].trim()) {
      result[kind] = { ok: false, error: 'Комбинация не указана' }
    }
  }

  for (let i = 0; i < KINDS.length; i++) {
    for (let j = i + 1; j < KINDS.length; j++) {
      const a = KINDS[i]
      const b = KINDS[j]
      if (result[a].error || result[b].error) continue
      if (hotkeys[a].toLowerCase() === hotkeys[b].toLowerCase()) {
        result[a] = { ok: false, error: `Совпадает с хоткеем «${LABELS[b]}»` }
        result[b] = { ok: false, error: `Совпадает с хоткеем «${LABELS[a]}»` }
      }
    }
  }

  const handlerByKind: Record<HotkeyKind, () => void> = {
    region: handlers.onRegion,
    fullscreen: handlers.onFullscreen,
    document: handlers.onDocument
  }

  for (const kind of KINDS) {
    if (hotkeys[kind].trim() && !result[kind].error) {
      try {
        const ok = globalShortcut.register(hotkeys[kind], handlerByKind[kind])
        result[kind] = ok
          ? { ok: true }
          : { ok: false, error: 'Не удалось зарегистрировать — комбинация уже занята другим приложением' }
      } catch (err) {
        result[kind] = { ok: false, error: (err as Error).message || 'Некорректная комбинация клавиш' }
      }
    }
  }

  return result
}

export function unregisterAllHotkeys(): void {
  globalShortcut.unregisterAll()
}
