import { app, net, safeStorage, shell } from 'electron'
import { readFileSync, writeFileSync, renameSync, rmSync } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { API_KEY_PROVIDERS, PROVIDER_NAMES, type ActivityRecord, type ApiKeyProviderId, type ProviderId } from '../../shared/providers'
import { PROVIDER_CATALOG, extraFields, fieldSecretId } from '../../shared/providerCatalog'
import type { ProviderKeyRef } from '../../shared/types'
import { getSettings, updateSettings } from '../settingsStore'
import { logEvent } from '../logger'
import { createChatGPT, type ChatGPTClient, type CredentialEncryption } from '../vendor/siwc-local/index'
import { ActivityLog } from './activityLog'
import { resolveFlags, type IntegrationFlags } from './featureFlags'
import { ProviderManager } from './manager'
import { RecognitionService } from './recognition'
import { ElectronSecretStore } from './secretStoreElectron'
import { UsageService } from './usageService'
import { ChatGptProvider, sessionNeedsReauth } from './impl/chatgpt'
import { ClaudeSubscriptionProvider } from './impl/claudeSubscription'
import { GeminiProvider } from './impl/gemini'
import { GroqProvider } from './impl/groq'
import { OpenAiApiProvider } from './impl/openaiApi'
import { AnthropicApiProvider } from './impl/anthropicApi'
import { TesseractProvider } from './impl/tesseract'
import { OpenAICompatibleProvider } from './impl/openaiCompatible'
import { CEREBRAS_CONFIG, CLOUDFLARE_CONFIG, HUGGINGFACE_CONFIG, MODAL_CONFIG, NVIDIA_CONFIG, OPENROUTER_CONFIG, validateModalEndpoint } from './impl/compatProviders'
import { MistralProvider } from './impl/mistral'
import { CohereProvider } from './impl/cohere'
import type { ApiKeyProviderDeps } from './impl/apiKeyProvider'
import { tesseractEngine } from '../ai/local'

const NETWORK_CHECK_MS = 20_000

export interface ProviderSystem {
  manager: ProviderManager
  usage: UsageService
  activity: ActivityLog
  recognition: RecognitionService
  secrets: ElectronSecretStore
  flags: IntegrationFlags
  chatgpt: ChatGptProvider
  tesseract: TesseractProvider
  setApiKey(provider: ApiKeyProviderId, input: { keyId?: string; label?: string; apiKey: string }): Promise<void>
  /** Saves non-key credential fields (Cloudflare account ID, Modal endpoint, ...). An empty value removes the field. */
  setFields(provider: ApiKeyProviderId, values: Record<string, string>): Promise<void>
  clearFields(provider: ApiKeyProviderId): void
  /** The saved secret behind an explicit Reveal / Copy. Main process only. */
  readSecret(provider: ApiKeyProviderId, ref: { keyId?: string; field?: string }): string | null
  /** Every credential the user has saved, for the explicit "Export API keys" action. */
  collectCredentials(): { provider: ApiKeyProviderId; env: string; value: string }[]
  renameKey(provider: ApiKeyProviderId, keyId: string, label: string): void
  removeKey(provider: ApiKeyProviderId, keyId: string): Promise<void>
  dispose(): void
}

/** Electron safeStorage adapter for the Sign in with ChatGPT SDK (DPAPI on Windows). */
const safeStorageEncryption: CredentialEncryption = {
  id: 'electron-safestorage',
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plaintext) => safeStorage.encryptString(plaintext),
  decrypt: (ciphertext) => safeStorage.decryptString(Buffer.from(ciphertext))
}

function activityPersistence(file: string): { load(): ActivityRecord[]; save(records: ActivityRecord[]): void } {
  return {
    load() {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf-8')) as { records?: ActivityRecord[] }
        return Array.isArray(parsed.records) ? parsed.records : []
      } catch {
        return []
      }
    },
    save(records) {
      const temp = `${file}.${randomUUID()}.tmp`
      try {
        writeFileSync(temp, JSON.stringify({ version: 1, records }), 'utf-8')
        renameSync(temp, file)
      } finally {
        rmSync(temp, { force: true })
      }
    }
  }
}

/** Builds the provider system. Must run after app 'ready' (safeStorage). */
export function createProviderSystem(): ProviderSystem {
  const userData = app.getPath('userData')
  const flags = resolveFlags()
  const secrets = new ElectronSecretStore(userData)
  const usage = new UsageService()
  const activity = new ActivityLog(activityPersistence(path.join(userData, 'ai-activity.json')))
  const aiSettings = (): ReturnType<typeof getSettings>['ai'] => getSettings().ai

  const manager = new ProviderManager({
    usage,
    activity,
    getSettings: aiSettings,
    logger: { log: (entry) => logEvent('ai', { ...entry }) }
  })

  let chatgptClient: ChatGPTClient | null = null
  const getChatGptClient = (): ChatGPTClient | null => {
    if (chatgptClient) return chatgptClient
    if (!safeStorage.isEncryptionAvailable()) return null
    chatgptClient = createChatGPT({
      appName: 'Snap Notes',
      appId: 'snap-notes',
      redirectPort: 0,
      storageDir: path.join(userData, 'chatgpt'),
      credentialEncryption: safeStorageEncryption,
      openBrowser: (url) => shell.openExternal(url),
      // The SIWC docs list ext_agent_host_id as required; the SDK persists a urn:uuid host ID once.
      sendHostId: true
    })
    return chatgptClient
  }

  const keyDeps = (provider: ApiKeyProviderId, enabled: boolean): ApiKeyProviderDeps => ({
    secrets,
    getKeys: () => getSettings().providerKeys[provider] ?? [],
    getLegacyKey: (id) => getSettings().aiKeys.find((k) => k.id === id)?.apiKey ?? null,
    getFields: () => readFields(secrets, provider),
    getModel: () => aiSettings().models[provider] ?? 'auto',
    integrationEnabled: enabled
  })

  const chatgpt = new ChatGptProvider({
    getClient: getChatGptClient,
    getModel: () => aiSettings().models.chatgpt ?? 'auto',
    integrationEnabled: flags.chatgptPlanAuth,
    integrationNote: flags.chatgptPlanAuth
      ? undefined
      : 'Использование плана ChatGPT недоступно в этой сборке. Подключите OpenAI API.'
  })
  const tesseract = new TesseractProvider(tesseractEngine, flags.tesseract)

  manager.register(chatgpt)
  manager.register(new ClaudeSubscriptionProvider())
  manager.register(new GeminiProvider(keyDeps('gemini', flags.geminiApi)))
  manager.register(new GroqProvider(keyDeps('groq', flags.groqApi)))
  manager.register(new OpenAiApiProvider(keyDeps('openai', flags.openaiApi)))
  manager.register(new AnthropicApiProvider(keyDeps('anthropic', flags.anthropicApi)))
  manager.register(new OpenAICompatibleProvider(OPENROUTER_CONFIG, keyDeps('openrouter', flags.openrouterApi)))
  manager.register(new MistralProvider(keyDeps('mistral', flags.mistralApi)))
  manager.register(new OpenAICompatibleProvider(CEREBRAS_CONFIG, keyDeps('cerebras', flags.cerebrasApi)))
  manager.register(new OpenAICompatibleProvider(CLOUDFLARE_CONFIG, keyDeps('cloudflare', flags.cloudflareAi)))
  manager.register(new OpenAICompatibleProvider(NVIDIA_CONFIG, keyDeps('nvidia', flags.nvidiaNim)))
  manager.register(new CohereProvider(keyDeps('cohere', flags.cohereApi)))
  manager.register(new OpenAICompatibleProvider(HUGGINGFACE_CONFIG, keyDeps('huggingface', flags.huggingfaceApi)))
  manager.register(new OpenAICompatibleProvider(MODAL_CONFIG, keyDeps('modal', flags.modalOcr)))
  manager.register(tesseract)

  chatgpt.onSessionChange((session) => {
    const auth = sessionNeedsReauth(session)
        ? ('AUTH_EXPIRED' as const)
        : session.status === 'connected' && !session.sharing
          ? ('AUTH_REQUIRED' as const)
          : null
    usage.setAuthState('chatgpt', auth)
    void manager.refreshStatus('chatgpt')
  })

  const recognition = new RecognitionService(manager, tesseract, aiSettings)

  usage.setOnline(net.isOnline())
  const networkTimer = setInterval(() => usage.setOnline(net.isOnline()), NETWORK_CHECK_MS)

  const refreshProvider = async (id: ProviderId): Promise<void> => {
    usage.resetProvider(id)
    await manager.get(id)?.refreshAuthentication().catch(() => undefined)
    await manager.refreshStatus(id)
  }

  return {
    manager,
    usage,
    activity,
    recognition,
    secrets,
    flags,
    chatgpt,
    tesseract,

    async setApiKey(provider, input) {
      const value = input.apiKey.trim()
      if (!value) throw new Error('Ключ пустой.')
      if (!secrets.isSecure()) throw new Error('Защищённое хранилище Windows недоступно — ключ не сохранён.')
      const refs = getSettings().providerKeys[provider] ?? []
      const existing = input.keyId ? refs.find((r) => r.id === input.keyId) : undefined
      const id = existing?.id ?? randomUUID()
      // Write + read-back verification happen inside the store; nothing is saved on failure.
      if (!secrets.set(id, value)) throw new Error('Не удалось надёжно сохранить ключ.')
      const label = input.label?.trim() || existing?.label || defaultLabel(provider, refs)
      const nextRefs: ProviderKeyRef[] = existing
        ? refs.map((r) => (r.id === id ? { id, label } : r))
        : [...refs, { id, label }]
      const settings = getSettings()
      updateSettings({
        providerKeys: { ...settings.providerKeys, [provider]: nextRefs },
        aiKeys: settings.aiKeys.filter((k) => k.id !== id)
      })
      await refreshProvider(provider)
    },

    async setFields(provider, values) {
      if (!secrets.isSecure()) throw new Error('Защищённое хранилище Windows недоступно — данные не сохранены.')
      const known = new Map(extraFields(provider).map((f) => [f.id, f]))
      for (const [id, raw] of Object.entries(values)) {
        if (!known.has(id)) throw new Error('Неизвестное поле.')
        const value = raw.trim()
        if (value.length > 500) throw new Error('Значение слишком длинное.')
        if (provider === 'modal' && id === 'endpoint' && value) {
          const problem = validateModalEndpoint(value)
          if (problem) throw new Error(problem)
        }
        if (!value) {
          secrets.delete(fieldSecretId(provider, id))
        } else if (!secrets.set(fieldSecretId(provider, id), value)) {
          throw new Error('Не удалось надёжно сохранить значение.')
        }
      }
      await refreshProvider(provider)
    },

    clearFields(provider) {
      for (const field of extraFields(provider)) secrets.delete(fieldSecretId(provider, field.id))
    },

    readSecret(provider, ref) {
      if (ref.field) {
        return extraFields(provider).some((f) => f.id === ref.field) ? secrets.get(fieldSecretId(provider, ref.field)) : null
      }
      const settings = getSettings()
      const known = (settings.providerKeys[provider] ?? []).some((r) => r.id === ref.keyId)
      if (!ref.keyId || !known) return null
      return secrets.get(ref.keyId) ?? settings.aiKeys.find((k) => k.id === ref.keyId)?.apiKey ?? null
    },

    collectCredentials() {
      const settings = getSettings()
      const result: { provider: ApiKeyProviderId; env: string; value: string }[] = []
      for (const provider of API_KEY_PROVIDERS) {
        const refs = settings.providerKeys[provider] ?? []
        if (refs.length === 0) continue
        const keyField = PROVIDER_CATALOG[provider].fields.find((f) => f.id === 'apiKey')
        refs.forEach((ref, index) => {
          const value = secrets.get(ref.id) ?? settings.aiKeys.find((k) => k.id === ref.id)?.apiKey ?? null
          if (value && keyField) result.push({ provider, env: index === 0 ? keyField.env : `${keyField.env}_${index + 1}`, value })
        })
        for (const field of extraFields(provider)) {
          const value = secrets.get(fieldSecretId(provider, field.id))
          if (value) result.push({ provider, env: field.env, value })
        }
      }
      return result
    },

    renameKey(provider, keyId, label) {
      const settings = getSettings()
      const refs = settings.providerKeys[provider] ?? []
      updateSettings({
        providerKeys: {
          ...settings.providerKeys,
          [provider]: refs.map((r) => (r.id === keyId ? { ...r, label: label.trim().slice(0, 80) || r.label } : r))
        }
      })
      manager.emit()
    },

    async removeKey(provider, keyId) {
      secrets.delete(keyId)
      const settings = getSettings()
      updateSettings({
        providerKeys: { ...settings.providerKeys, [provider]: (settings.providerKeys[provider] ?? []).filter((r) => r.id !== keyId) },
        aiKeys: settings.aiKeys.filter((k) => k.id !== keyId)
      })
      await manager.get(provider)?.disconnect()
      await refreshProvider(provider)
    },

    dispose() {
      clearInterval(networkTimer)
      manager.cancelAll()
      activity.flush()
      usage.dispose()
    }
  }
}

function defaultLabel(provider: ApiKeyProviderId, refs: ProviderKeyRef[]): string {
  const base = PROVIDER_NAMES[provider]
  return refs.length === 0 ? base : `${base} #${refs.length + 1}`
}

/** Saved extra credential fields of a provider, by field id (empty ones omitted). */
function readFields(secrets: ElectronSecretStore, provider: ApiKeyProviderId): Record<string, string> {
  const values: Record<string, string> = {}
  for (const field of extraFields(provider)) {
    const value = secrets.get(fieldSecretId(provider, field.id))
    if (value) values[field.id] = value
  }
  return values
}
