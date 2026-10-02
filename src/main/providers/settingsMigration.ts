import {
  API_KEY_PROVIDERS,
  DEFAULT_AI_SETTINGS,
  DEFAULT_PRIORITY,
  PROVIDER_IDS,
  AI_PREFERENCES,
  type AiPreference,
  type AiSettings,
  type AiUsageMode,
  type ApiKeyProviderId,
  type ProviderId
} from '../../shared/providers'
import type { AiKeyEntry, ProviderKeyRef, ProviderKeyRefs } from '../../shared/types'
import type { SecretStore } from './secretStore'

export interface StoredAiState {
  aiKeys?: AiKeyEntry[]
  useHybridPipeline?: boolean
  ai?: Partial<AiSettings>
  providerKeys?: Partial<ProviderKeyRefs>
}

export interface AiMigrationResult {
  ai: AiSettings
  providerKeys: ProviderKeyRefs
  /** Legacy entries that must stay (secure storage unavailable or its verification failed). */
  remainingLegacyKeys: AiKeyEntry[]
  migratedKeyIds: string[]
  failedKeyIds: string[]
  changed: boolean
}

const MODES: AiUsageMode[] = ['best', 'balanced', 'economy', 'offline']

function isApiKeyProvider(value: string): value is ApiKeyProviderId {
  return (API_KEY_PROVIDERS as string[]).includes(value)
}

/** Normalizes priority: known cloud providers only, no duplicates, missing ones appended in default order. */
export function normalizePriority(priority: unknown): ProviderId[] {
  const result: ProviderId[] = []
  if (Array.isArray(priority)) {
    for (const id of priority) {
      if (typeof id !== 'string' || id === 'tesseract') continue
      if (!(PROVIDER_IDS as string[]).includes(id)) continue
      if (!result.includes(id as ProviderId)) result.push(id as ProviderId)
    }
  }
  for (const id of DEFAULT_PRIORITY) if (!result.includes(id)) result.push(id)
  return result
}

export function normalizeAiSettings(value: Partial<AiSettings> | undefined): AiSettings {
  const v = value ?? {}
  const models: AiSettings['models'] = {}
  if (v.models && typeof v.models === 'object') {
    for (const [id, model] of Object.entries(v.models)) {
      if ((PROVIDER_IDS as string[]).includes(id) && typeof model === 'string' && model.length <= 200) {
        models[id as ProviderId] = model
      }
    }
  }
  return {
    mode: MODES.includes(v.mode as AiUsageMode) ? (v.mode as AiUsageMode) : DEFAULT_AI_SETTINGS.mode,
    prefer: AI_PREFERENCES.includes(v.prefer as AiPreference) ? (v.prefer as AiPreference) : DEFAULT_AI_SETTINGS.prefer,
    priority: normalizePriority(v.priority),
    autoFallback: typeof v.autoFallback === 'boolean' ? v.autoFallback : DEFAULT_AI_SETTINGS.autoFallback,
    protectLowLimits: typeof v.protectLowLimits === 'boolean' ? v.protectLowLimits : DEFAULT_AI_SETTINGS.protectLowLimits,
    preferredProvider:
      typeof v.preferredProvider === 'string' && (PROVIDER_IDS as string[]).includes(v.preferredProvider)
        ? v.preferredProvider
        : null,
    models,
    debugContentLogging: v.debugContentLogging === true,
    chatgptWelcomeSeen: v.chatgptWelcomeSeen === true
  }
}

function normalizeKeyRefs(value: Partial<ProviderKeyRefs> | undefined): ProviderKeyRefs {
  const result = Object.fromEntries(API_KEY_PROVIDERS.map((p) => [p, []])) as unknown as ProviderKeyRefs
  for (const provider of API_KEY_PROVIDERS) {
    const list = value?.[provider]
    if (!Array.isArray(list)) continue
    for (const ref of list) {
      if (ref && typeof ref.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(ref.id) && typeof ref.label === 'string') {
        result[provider].push({ id: ref.id, label: ref.label.slice(0, 80) })
      }
    }
  }
  return result
}

/**
 * Converts ≤1.3.1 settings (aiKeys with plaintext keys, useHybridPipeline) to the provider config.
 *
 * Keys: for each legacy key → write to secure storage → the store reads it back and compares →
 * only a verified key is dropped from the plaintext list. Anything that fails stays exactly as it
 * was, so no key is ever lost. Idempotent: running it again changes nothing.
 */
export function migrateAiSettings(state: StoredAiState, secrets: SecretStore): AiMigrationResult {
  const legacy = Array.isArray(state.aiKeys) ? state.aiKeys : []
  const providerKeys = normalizeKeyRefs(state.providerKeys)
  const migratedKeyIds: string[] = []
  const failedKeyIds: string[] = []
  const remainingLegacyKeys: AiKeyEntry[] = []
  let changed = false

  let ai: AiSettings
  if (!state.ai) {
    // First launch of the provider architecture: keep the user's behavior.
    const hadCloudKeys = legacy.some((k) => k.provider !== 'local' && k.apiKey?.trim())
    const mode: AiUsageMode = state.useHybridPipeline ? 'economy' : hadCloudKeys ? 'best' : DEFAULT_AI_SETTINGS.mode
    const legacyOrder: ProviderId[] = []
    for (const key of legacy) {
      if ((key.provider === 'gemini' || key.provider === 'groq') && !legacyOrder.includes(key.provider)) legacyOrder.push(key.provider)
    }
    ai = normalizeAiSettings({ ...DEFAULT_AI_SETTINGS, mode, priority: ['chatgpt', 'claude', ...legacyOrder] })
    changed = true
  } else {
    ai = normalizeAiSettings(state.ai)
  }

  for (const key of legacy) {
    if (!key || typeof key.id !== 'string') continue
    if (key.provider === 'local') {
      // Tesseract is built in now; the old "local" entry is simply no longer needed.
      changed = true
      continue
    }
    const value = typeof key.apiKey === 'string' ? key.apiKey.trim() : ''
    if (!isApiKeyProvider(key.provider) || !value) {
      changed = true
      continue
    }
    const ref: ProviderKeyRef = { id: key.id, label: key.label || key.provider }
    if (!providerKeys[key.provider].some((r) => r.id === key.id)) {
      providerKeys[key.provider].push(ref)
      changed = true
    }
    const alreadyStored = secrets.isSecure() && secrets.get(key.id) === value
    const verified = alreadyStored || (secrets.isSecure() && secrets.set(key.id, value))
    if (verified) {
      migratedKeyIds.push(key.id)
      changed = true
    } else {
      failedKeyIds.push(key.id)
      remainingLegacyKeys.push(key)
    }
  }

  return { ai, providerKeys, remainingLegacyKeys, migratedKeyIds, failedKeyIds, changed }
}
