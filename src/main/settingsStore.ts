import { randomUUID } from 'crypto'
import Store from 'electron-store'
import { AiKeyEntry, AppSettings, DEFAULT_SETTINGS } from '../shared/types'
import type { AiSettings } from '../shared/providers'
import { migrateAiSettings, normalizeAiSettings, type AiMigrationResult } from './providers/settingsMigration'
import type { SecretStore } from './providers/secretStore'
import { sanitizeUiSettings } from '../shared/settingsSanitize'

type StoredSettings = Partial<AppSettings> & { geminiApiKey?: string }

interface StoreShape {
  settings: StoredSettings
}

const store = new Store<StoreShape>({
  name: 'config',
  defaults: { settings: DEFAULT_SETTINGS },
  encryptionKey: 'snap-notes-local-store-v1'
})

function migrateLegacyKey(stored: StoredSettings): AiKeyEntry[] {
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
    ai: normalizeAiSettings(stored?.ai),
    providerKeys: { ...DEFAULT_SETTINGS.providerKeys, ...(stored?.providerKeys ?? {}) },
    hotkeys: { ...DEFAULT_SETTINGS.hotkeys, ...(stored?.hotkeys ?? {}) }
  }
  return settings
}

/** Settings as the renderer may see them: no key material of any kind. */
export function getPublicSettings(): AppSettings {
  return { ...getSettings(), aiKeys: [] }
}

export type SettingsPatch = Omit<Partial<AppSettings>, 'ai'> & { ai?: Partial<AiSettings> }

export function updateSettings(patch: SettingsPatch): AppSettings {
  const current = getSettings()
  const next: AppSettings = {
    ...current,
    ...patch,
    ai: patch.ai ? normalizeAiSettings({ ...current.ai, ...patch.ai }) : current.ai,
    hotkeys: { ...current.hotkeys, ...(patch.hotkeys ?? {}) }
  }
  store.set('settings', next)
  return next
}

/** Patch coming from the renderer: key material and key references can only change via provider IPC. */
export function sanitizeRendererPatch(patch: SettingsPatch): SettingsPatch {
  const { aiKeys: _aiKeys, providerKeys: _providerKeys, ...rest } = patch
  return sanitizeUiSettings(rest as Partial<AppSettings>) as unknown as SettingsPatch
}

/**
 * One-time (idempotent) move to the provider architecture: legacy plaintext keys → OS-encrypted
 * storage (verified before the plaintext copy is removed), hybrid toggle → AI usage mode.
 */
export function runAiMigration(secrets: SecretStore): AiMigrationResult {
  const stored = store.get('settings')
  const result = migrateAiSettings(
    {
      aiKeys: migrateLegacyKey(stored),
      useHybridPipeline: stored?.useHybridPipeline,
      ai: stored?.ai,
      providerKeys: stored?.providerKeys
    },
    secrets
  )
  if (result.changed || stored?.geminiApiKey) {
    const { geminiApiKey: _legacy, ...rest } = stored
    // Secrets were already written and verified; only now does the plaintext copy go away.
    store.set('settings', {
      ...rest,
      ai: result.ai,
      providerKeys: result.providerKeys,
      aiKeys: result.remainingLegacyKeys
    })
  }
  return result
}

export function resetSettings(): AppSettings {
  store.set('settings', DEFAULT_SETTINGS)
  return DEFAULT_SETTINGS
}
