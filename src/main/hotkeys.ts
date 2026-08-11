import { globalShortcut } from 'electron'
import { HotkeyConfig, HotkeyRegistrationResult } from '../shared/types'

export interface HotkeyHandlers {
  onRegion: () => void
  onFullscreen: () => void
}

export function registerHotkeys(hotkeys: HotkeyConfig, handlers: HotkeyHandlers): HotkeyRegistrationResult {
  globalShortcut.unregisterAll()

  const result: HotkeyRegistrationResult = {
    region: { ok: false },
    fullscreen: { ok: false }
  }

  if (!hotkeys.region.trim() || !hotkeys.fullscreen.trim()) {
    if (!hotkeys.region.trim()) result.region = { ok: false, error: 'Комбинация не указана' }
    if (!hotkeys.fullscreen.trim()) result.fullscreen = { ok: false, error: 'Комбинация не указана' }
  }

  if (
    hotkeys.region.trim() &&
    hotkeys.fullscreen.trim() &&
    hotkeys.region.toLowerCase() === hotkeys.fullscreen.toLowerCase()
  ) {
    result.region = { ok: false, error: 'Совпадает с хоткеем «весь экран»' }
    result.fullscreen = { ok: false, error: 'Совпадает с хоткеем «область экрана»' }
    return result
  }

  if (hotkeys.region.trim() && !result.region.error) {
    try {
      const ok = globalShortcut.register(hotkeys.region, handlers.onRegion)
      result.region = ok
        ? { ok: true }
        : { ok: false, error: 'Не удалось зарегистрировать — комбинация уже занята другим приложением' }
    } catch (err) {
      result.region = { ok: false, error: (err as Error).message || 'Некорректная комбинация клавиш' }
    }
  }

  if (hotkeys.fullscreen.trim() && !result.fullscreen.error) {
    try {
      const ok = globalShortcut.register(hotkeys.fullscreen, handlers.onFullscreen)
      result.fullscreen = ok
        ? { ok: true }
        : { ok: false, error: 'Не удалось зарегистрировать — комбинация уже занята другим приложением' }
    } catch (err) {
      result.fullscreen = { ok: false, error: (err as Error).message || 'Некорректная комбинация клавиш' }
    }
  }

  return result
}

export function unregisterAllHotkeys(): void {
  globalShortcut.unregisterAll()
}
