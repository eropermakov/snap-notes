import { ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { IPC } from '../shared/ipc'
import { API_KEY_PROVIDERS, PROVIDER_IDS, type ApiKeyProviderId, type ProviderId } from '../shared/providers'
import type { ProviderSystem } from './providers'
import { ProviderError, isProviderError } from './providers/errors'
import type { HealthCheckResult } from './providers/types'
import { CHATGPT_MANAGE_USAGE_URL } from './providers/impl/chatgpt'
import { CLAUDE_MANAGE_USAGE_URL } from './providers/impl/claudeSubscription'
import { logEvent } from './logger'
import { runAiAction, tidySource } from './noteActions'
import { getSettings } from './settingsStore'
import type { AiAction } from '../shared/ocrPrompts'

const AI_ACTIONS: AiAction[] = ['shorten', 'explain', 'rewrite', 'translate', 'list', 'keypoints']

/** Official usage pages only. Opened in the system browser, never embedded. */
const MANAGE_USAGE_URLS: Partial<Record<ProviderId, string>> = {
  chatgpt: CHATGPT_MANAGE_USAGE_URL,
  claude: CLAUDE_MANAGE_USAGE_URL,
  gemini: 'https://aistudio.google.com/usage',
  groq: 'https://console.groq.com/settings/limits',
  openai: 'https://platform.openai.com/usage',
  anthropic: 'https://platform.claude.com/usage'
}

export interface ActionResult {
  ok: boolean
  message?: string
  /** PROVIDERS_SET_KEY: the key was written to secure storage (even if the connection check failed). */
  saved?: boolean
}

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDER_IDS as string[]).includes(value)
}

function isApiKeyProvider(value: unknown): value is ApiKeyProviderId {
  return typeof value === 'string' && (API_KEY_PROVIDERS as string[]).includes(value)
}

/** A failed check is real information about the provider: reflect it in its status. */
function applyHealth(system: ProviderSystem, provider: ProviderId, result: HealthCheckResult): void {
  if (result.ok) system.usage.resetProvider(provider)
  else if (result.errorCode && result.errorCode !== 'CANCELLED') system.usage.recordError(new ProviderError(provider, result.errorCode))
}

function failure(err: unknown): ActionResult {
  if (isProviderError(err)) return { ok: false, message: err.message }
  return { ok: false, message: err instanceof Error ? err.message : 'Не удалось выполнить действие.' }
}

/**
 * Provider IPC. Responses carry only ProviderPublicState-style data (status, account label, usage) —
 * never an API key or OAuth token. Keys travel renderer → main once, when the user pastes them.
 */
export function registerProviderIpc(system: ProviderSystem, getMainWindow: () => BrowserWindow | null): void {
  const fromMainWindow = (event: IpcMainInvokeEvent): boolean => {
    const win = getMainWindow()
    return Boolean(win && !win.isDestroyed() && event.sender === win.webContents)
  }
  const handle = (channel: string, fn: (...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!fromMainWindow(event)) throw new Error('Forbidden')
      return fn(...args)
    })
  }

  handle(IPC.PROVIDERS_LIST, () => system.manager.publicStates())

  handle(IPC.PROVIDERS_SET_KEY, async (provider, input) => {
    if (!isApiKeyProvider(provider)) return { ok: false, message: 'Неизвестный источник.' }
    const data = (input ?? {}) as { keyId?: unknown; label?: unknown; apiKey?: unknown }
    if (typeof data.apiKey !== 'string' || data.apiKey.length > 500) return { ok: false, message: 'Некорректный ключ.' }
    try {
      await system.setApiKey(provider, {
        apiKey: data.apiKey,
        ...(typeof data.keyId === 'string' ? { keyId: data.keyId } : {}),
        ...(typeof data.label === 'string' ? { label: data.label } : {})
      })
      const check = await system.manager.get(provider)!.healthCheck()
      applyHealth(system, provider, check)
      await system.manager.refreshStatus(provider)
      return { ok: check.ok, saved: true, message: check.ok ? check.message : `Ключ сохранён, но проверка не прошла: ${check.message}` }
    } catch (err) {
      return { ...failure(err), saved: false }
    }
  })

  handle(IPC.PROVIDERS_RENAME_KEY, (provider, keyId, label) => {
    if (!isApiKeyProvider(provider) || typeof keyId !== 'string' || typeof label !== 'string') return { ok: false }
    system.renameKey(provider, keyId, label)
    return { ok: true }
  })

  handle(IPC.PROVIDERS_REMOVE_KEY, async (provider, keyId) => {
    if (!isApiKeyProvider(provider) || typeof keyId !== 'string') return { ok: false }
    await system.removeKey(provider, keyId)
    return { ok: true }
  })

  handle(IPC.PROVIDERS_TEST, async (provider) => {
    if (!isProviderId(provider)) return { ok: false, message: 'Неизвестный источник.' }
    const target = system.manager.get(provider)
    if (!target) return { ok: false, message: 'Неизвестный источник.' }
    const result = await target.healthCheck()
    applyHealth(system, provider, result)
    await system.manager.refreshStatus(provider)
    return result
  })

  handle(IPC.PROVIDERS_CONNECT, async (provider, options) => {
    if (!isProviderId(provider)) return { ok: false, message: 'Неизвестный источник.' }
    const target = system.manager.get(provider)
    if (!target) return { ok: false, message: 'Неизвестный источник.' }
    const reconsent = Boolean((options as { reconsent?: unknown } | undefined)?.reconsent)
    try {
      system.manager.emit()
      await target.connect({ reconsent })
      system.usage.resetProvider(provider)
      await system.manager.refreshStatus(provider)
      logEvent('provider', { provider, action: 'connect', ok: true })
      return { ok: true }
    } catch (err) {
      await system.manager.refreshStatus(provider)
      logEvent('provider', { provider, action: 'connect', ok: false, code: isProviderError(err) ? err.code : 'UNKNOWN' })
      return failure(err)
    }
  })

  handle(IPC.PROVIDERS_CANCEL_CONNECT, (provider) => {
    if (provider === 'chatgpt') system.chatgpt.cancelConnect()
    return { ok: true }
  })

  handle(IPC.PROVIDERS_DISCONNECT, async (provider) => {
    if (!isProviderId(provider)) return { ok: false }
    const target = system.manager.get(provider)
    if (!target) return { ok: false }
    try {
      if (isApiKeyProvider(provider)) {
        for (const key of (await target.getConnectionInfo()).keys ?? []) await system.removeKey(provider, key.id)
      } else {
        await target.disconnect()
      }
      system.usage.resetProvider(provider)
      await system.manager.refreshStatus(provider)
      logEvent('provider', { provider, action: 'disconnect', ok: true })
      return { ok: true }
    } catch (err) {
      await system.manager.refreshStatus(provider)
      return failure(err)
    }
  })

  handle(IPC.PROVIDERS_REFRESH_MODELS, async (provider) => {
    if (!isProviderId(provider)) return { ok: false }
    try {
      await system.manager.get(provider)?.getAvailableModels({ refresh: true })
      system.manager.emit()
      return { ok: true }
    } catch (err) {
      return failure(err)
    }
  })

  handle(IPC.PROVIDERS_REFRESH_USAGE, async (provider) => {
    // Status refresh only: free calls and cached facts, never a paid request.
    if (isProviderId(provider)) {
      system.usage.markStale(provider)
      await system.manager.refreshStatus(provider)
    } else {
      await system.manager.refreshAll()
    }
    return { ok: true }
  })

  handle(IPC.PROVIDERS_OPEN_MANAGE_USAGE, async (provider) => {
    if (!isProviderId(provider)) return { ok: false }
    const url = MANAGE_USAGE_URLS[provider]
    if (!url) return { ok: false }
    await shell.openExternal(url)
    return { ok: true }
  })

  handle(IPC.ACTIVITY_SUMMARY, () => system.activity.summary())

  const broadcastNote = (note: unknown): void => {
    const win = getMainWindow()
    if (note && win && !win.isDestroyed()) win.webContents.send(IPC.ON_NOTE_UPDATED, note)
  }

  // "Привести в порядок": correction only, never rewriting (§18). Offline → local cleanup.
  handle(IPC.NOTES_TIDY_SOURCE, async (noteId, sourceId) => {
    if (typeof noteId !== 'string' || typeof sourceId !== 'string') return { ok: false }
    const outcome = await tidySource(system.manager, noteId, sourceId, getSettings().ai.mode === 'offline')
    broadcastNote(outcome.note)
    return { ok: outcome.ok, message: outcome.message, provider: outcome.provider }
  })

  // Explicit AI actions: shorten / explain / rewrite / translate / list / keypoints.
  handle(IPC.NOTES_AI_ACTION, async (noteId, sourceId, action, language) => {
    if (typeof noteId !== 'string' || typeof sourceId !== 'string' || !AI_ACTIONS.includes(action as AiAction)) {
      return { ok: false }
    }
    const lang = typeof language === 'string' && language.length <= 40 ? language : undefined
    const outcome = await runAiAction(system.manager, noteId, sourceId, action as AiAction, getSettings().ai.mode === 'offline', lang)
    broadcastNote(outcome.note)
    return { ok: outcome.ok, message: outcome.message, provider: outcome.provider }
  })

  // Push provider changes to the renderer (debounced; no network involved).
  let timer: ReturnType<typeof setTimeout> | null = null
  system.manager.onChange(() => {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      const win = getMainWindow()
      if (!win || win.isDestroyed()) return
      void system.manager.publicStates().then((states) => {
        if (!win.isDestroyed()) win.webContents.send(IPC.ON_PROVIDERS_CHANGED, states)
      })
    }, 150)
  })
}
