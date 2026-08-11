import { randomUUID } from 'crypto'
import Store from 'electron-store'
import { AiKeyEntry, AppSettings, DEFAULT_SETTINGS } from '../shared/types'

interface StoreShape {
  settings: AppSettings & { geminiApiKey?: string }
}

const store = new Store<StoreShape>({
  name: 'config',
  defaults: { settings: DEFAULT_SETTINGS },
  encryptionKey: 'snap-notes-local-store-v1'
})

function migrateLegacyKey(stored: StoreShape['settings']): AiKeyEntry[] {
  if (Array.isArray(stored?.aiKeys) && stored.aiKeys.length > 0) return stored.aiKeys
  if (stored?.geminiApiKey && stored.geminiApiKey.trim()) {
    return [{ id: randomUUID(), provider: 'gemini', label: 'Gemini', apiKey: stored.geminiApiKey.trim() }]
  }
  return []
}

export function getSettings(): AppSettings {
  const stored = store.get('settings')
  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...stored,
    aiKeys: migrateLegacyKey(stored),
    hotkeys: { ...DEFAULT_SETTINGS.hotkeys, ...(stored?.hotkeys ?? {}) }
  }
  return settings
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const current = getSettings()
  const next: AppSettings = {
    ...current,
    ...patch,
    hotkeys: { ...current.hotkeys, ...(patch.hotkeys ?? {}) }
  }
  store.set('settings', next)
  return next
}

export function resetSettings(): AppSettings {
  store.set('settings', DEFAULT_SETTINGS)
  return DEFAULT_SETTINGS
}
