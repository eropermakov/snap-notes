import { app, clipboard, dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { writeFileSync } from 'fs'
import path from 'path'
import { PROVIDER_CATALOG } from '../shared/providerCatalog'
import { buildEnvFile } from './providers/credentialExport'
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
function manageUrl(provider: ProviderId): string | undefined {
  if (provider === 'chatgpt') return CHATGPT_MANAGE_USAGE_URL
  if (provider === 'claude') return CLAUDE_MANAGE_USAGE_URL
  return PROVIDER_CATALOG[provider]?.manageUrl
}

const CLIPBOARD_CLEAR_MS = 60_000

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

  handle(IPC.PROVIDERS_SET_FIELDS, async (provider, values) => {
    if (!isApiKeyProvider(provider) || !values || typeof values !== 'object') return { ok: false, message: 'Некорректные данные.' }
    const clean: Record<string, string> = {}
    for (const [id, value] of Object.entries(values as Record<string, unknown>)) {
      if (typeof value !== 'string') return { ok: false, message: 'Некорректные данные.' }
      clean[id] = value
    }
    try {
      await system.setFields(provider, clean)
      return { ok: true }
    } catch (err) {
      return failure(err)
    }
  })

  // Reveal / Copy are explicit user actions on one saved credential. Nothing is returned otherwise.
  const secretRef = (ref: unknown): { keyId?: string; field?: string } | null => {
    const data = (ref ?? {}) as { keyId?: unknown; field?: unknown }
    if (typeof data.keyId === 'string') return { keyId: data.keyId }
    if (typeof data.field === 'string') return { field: data.field }
    return null
  }

  handle(IPC.PROVIDERS_REVEAL_SECRET, (provider, ref) => {
    const parsed = secretRef(ref)
    if (!isApiKeyProvider(provider) || !parsed) return { ok: false }
    const value = system.readSecret(provider, parsed)
    return value ? { ok: true, value } : { ok: false }
  })

  handle(IPC.PROVIDERS_COPY_SECRET, (provider, ref) => {
    const parsed = secretRef(ref)
    if (!isApiKeyProvider(provider) || !parsed) return { ok: false }
    const value = system.readSecret(provider, parsed)
    if (!value) return { ok: false, message: 'Значение не найдено.' }
    clipboard.writeText(value)
    // A copied secret does not stay on the clipboard: it is cleared after a minute unless replaced.
    setTimeout(() => {
      try {
        if (clipboard.readText() === value) clipboard.clear()
      } catch {
        /* clipboard unavailable: nothing to clear */
      }
    }, CLIPBOARD_CLEAR_MS).unref()
    return { ok: true, message: 'Скопировано. Буфер обмена очистится через минуту.' }
  })

  handle(IPC.PROVIDERS_OPEN_KEY_PAGE, async (provider) => {
    if (!isProviderId(provider)) return { ok: false }
    const url = PROVIDER_CATALOG[provider]?.keyUrl
    if (!url) return { ok: false }
    await shell.openExternal(url)
    return { ok: true }
  })

  handle(IPC.PROVIDERS_EXPORT_KEYS, async () => {
    const credentials = system.collectCredentials()
    if (credentials.length === 0) return { ok: false, message: 'Нет сохранённых ключей для экспорта.' }
    const win = getMainWindow()
    const options = {
      type: 'warning' as const,
      title: 'Экспорт API-ключей',
      message: 'This file contains secret API credentials. Anyone with this file may use your accounts.',
      detail:
        'Файл будет содержать ваши секретные API-ключи в открытом виде. Любой, у кого он окажется, сможет пользоваться вашими аккаунтами. Не публикуйте его, не добавляйте в Git и не храните в облачных папках.',
      buttons: ['Отмена', 'Я понимаю, продолжить'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    }
    const confirm = win && !win.isDestroyed() ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    if (confirm.response !== 1) return { ok: false, cancelled: true }

    const saveOptions = {
      title: 'Сохранить API-ключи',
      defaultPath: path.join(app.getPath('documents'), 'SnapNotes_API_KEYS.env'),
      filters: [{ name: 'Env file', extensions: ['env'] }, { name: 'Все файлы', extensions: ['*'] }]
    }
    const save = win && !win.isDestroyed() ? await dialog.showSaveDialog(win, saveOptions) : await dialog.showSaveDialog(saveOptions)
    if (save.canceled || !save.filePath) return { ok: false, cancelled: true }
    try {
      writeFileSync(save.filePath, buildEnvFile(credentials.map(({ env, value }) => ({ env, value }))), { encoding: 'utf-8', mode: 0o600 })
      // Only the count is logged — never a name or a value.
      logEvent('provider', { action: 'export-keys', ok: true, count: credentials.length })
      return { ok: true, count: credentials.length, path: save.filePath }
    } catch (err) {
      logEvent('provider', { action: 'export-keys', ok: false })
      return failure(err)
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
        system.clearFields(provider)
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
    const url = manageUrl(provider)
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
