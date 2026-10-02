import type {
  ModelInfo,
  ProviderCapabilities,
  ProviderConnectionInfo,
  ProviderId,
  ProviderUsage,
  UsageWindow
} from '../../../shared/providers'
import { extraFields } from '../../../shared/providerCatalog'
import { ProviderError, codeFromHttpStatus, normalizeThrown } from '../errors'
import type { SecretStore } from '../secretStore'
import type {
  AIProvider,
  HealthCheckResult,
  IntegrationInfo,
  ProviderResult,
  TextRequest,
  VisionRequest
} from '../types'
import { isVisionRequest } from '../types'

export interface ApiKeyRef {
  id: string
  label: string
}

export interface ApiKeyProviderDeps {
  secrets: SecretStore
  /** Ordered key references for this provider (no secret values). */
  getKeys: () => ApiKeyRef[]
  /** Legacy plaintext lookup, used only when OS encryption was unavailable during migration. */
  getLegacyKey?: (id: string) => string | null
  /** Extra credential fields (Cloudflare account ID, Modal endpoint, …), by field id. */
  getFields?: () => Record<string, string>
  /** 'auto' or a model id. */
  getModel: () => string
  integrationEnabled: boolean
  fetchImpl?: typeof fetch
  now?: () => number
  timeoutMs?: number
}

export interface HttpResponse {
  status: number
  headers: Headers
  body: unknown
}

const DEFAULT_TIMEOUT_MS = 45_000
const KEY_RECHECK_MS = { rate: 60_000, plan: 15 * 60_000 }

export const API_CAPABILITIES: ProviderCapabilities = {
  vision: true,
  ocr: false,
  text: true,
  structuredOutput: true,
  ocrCleanup: true,
  tables: true,
  codeRecognition: true,
  translation: true,
  noteActions: true,
  embeddings: false
}

/**
 * Base class for API-key providers. Handles key rotation (several keys per provider, tried in order,
 * skipping keys that just hit a limit), model resolution, cancellation and timeouts. Subclasses only
 * translate one request into the provider's HTTP/SDK call and map its errors.
 */
export abstract class ApiKeyProvider implements AIProvider {
  abstract readonly id: ProviderId
  abstract readonly name: string
  readonly kind = 'api' as const
  readonly authType = 'api_key' as const
  readonly local = false

  protected readonly fetchImpl: typeof fetch
  protected readonly now: () => number
  protected lastRateLimits: UsageWindow[] = []
  /** Subclasses narrow this (text-only providers, OCR engines). */
  protected capabilities: ProviderCapabilities = API_CAPABILITIES
  /** Redirect policy for requests. 'error' by default so credentials are never sent to a redirected host. */
  protected redirectMode: RequestRedirect = 'error'
  protected modelsCache: ModelInfo[] | null = null
  /** Why the catalog could not be read (network down, 5xx), so a provider without a default model reports the real cause. */
  protected catalogError: ProviderError | null = null
  private readonly controllers = new Set<AbortController>()
  private readonly keyBlockedUntil = new Map<string, number>()

  constructor(protected readonly deps: ApiKeyProviderDeps) {
    this.fetchImpl = deps.fetchImpl ?? ((input, init) => fetch(input, init))
    this.now = deps.now ?? (() => Date.now())
  }

  // ---- subclass hooks ------------------------------------------------------------------------
  protected abstract listModels(apiKey: string, signal: AbortSignal): Promise<ModelInfo[]>
  protected abstract performRequest(
    apiKey: string,
    model: string,
    request: VisionRequest | TextRequest,
    signal: AbortSignal
  ): Promise<ProviderResult>
  /** Default model for Automatic, given the (possibly unknown) catalog. */
  protected abstract autoModel(models: ModelInfo[] | null, vision: boolean): string
  /** Whether a model accepts images: true/false when documented, undefined when unknown. */
  protected abstract modelVision(modelId: string, models: ModelInfo[] | null): boolean | undefined
  protected abstract integrationNote(): string | undefined

  // ---- AIProvider --------------------------------------------------------------------------------
  getIntegration(): IntegrationInfo {
    return { enabled: this.deps.integrationEnabled, note: this.integrationNote() }
  }

  async connect(): Promise<void> {
    /* API keys are added through ProviderManager.setApiKey */
  }

  async disconnect(): Promise<void> {
    this.modelsCache = null
    this.lastRateLimits = []
    this.keyBlockedUntil.clear()
  }

  async refreshAuthentication(): Promise<void> {
    this.keyBlockedUntil.clear()
  }

  async isAvailable(): Promise<boolean> {
    return this.deps.integrationEnabled && this.usableKeys().length > 0 && this.missingFields().length === 0
  }

  async getConnectionInfo(): Promise<ProviderConnectionInfo> {
    const keys = this.deps.getKeys().map((k) => ({ id: k.id, label: k.label, secure: this.deps.secrets.has(k.id) }))
    const values = this.fieldValues()
    const defs = extraFields(this.id)
    return {
      connected: this.usableKeys().length > 0 && this.missingFields().length === 0,
      keys,
      ...(defs.length
        ? {
            fields: defs.map((f) => ({
              id: f.id,
              set: Boolean(values[f.id]),
              ...(!f.secret && values[f.id] ? { value: values[f.id] } : {})
            }))
          }
        : {})
    }
  }

  async getAvailableModels(options: { refresh?: boolean; cachedOnly?: boolean } = {}): Promise<ModelInfo[]> {
    if (options.cachedOnly) return this.modelsCache ?? []
    if (this.modelsCache && !options.refresh) return this.modelsCache
    const key = this.usableKeys()[0]
    if (!key) return this.modelsCache ?? []
    const models = await this.withSignal((signal) => this.listModels(key.value, signal))
    this.modelsCache = models
    return models
  }

  getCapabilities(): ProviderCapabilities {
    return this.capabilities
  }

  async canServeVision(_imageBytes?: number): Promise<boolean> {
    const selected = this.deps.getModel()
    if (!selected || selected === 'auto') return true
    return this.modelVision(selected, this.modelsCache) !== false
  }

  runVision(request: VisionRequest): Promise<ProviderResult> {
    return this.execute(request)
  }

  runText(request: TextRequest): Promise<ProviderResult> {
    return this.execute(request)
  }

  runStructuredOutput(request: VisionRequest | TextRequest): Promise<ProviderResult> {
    return this.execute({ ...request, json: true })
  }

  async getUsage(): Promise<Partial<ProviderUsage> | null> {
    return null
  }

  getRateLimits(): UsageWindow[] {
    return this.lastRateLimits.map((w) => ({ ...w }))
  }

  cancelRequest(): void {
    for (const controller of this.controllers) controller.abort(new DOMException('Cancelled by user', 'AbortError'))
    this.controllers.clear()
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const keys = this.usableKeys()
    if (keys.length === 0) return { ok: false, message: 'Ключ не добавлен.' }
    try {
      const models = await this.withSignal((signal) => this.listModels(keys[0].value, signal))
      this.modelsCache = models
      return { ok: true, message: models.length ? `Подключено · моделей: ${models.length}` : 'Подключено' }
    } catch (err) {
      const error = normalizeThrown(this.id, err)
      return { ok: false, message: error.message, errorCode: error.code }
    }
  }

  // ---- internals ---------------------------------------------------------------------------------
  protected resolveModel(vision: boolean): string {
    const selected = this.deps.getModel()
    if (selected && selected !== 'auto') {
      if (vision && this.modelVision(selected, this.modelsCache) === false) {
        throw new ProviderError(this.id, 'UNSUPPORTED', { message: `Модель ${selected} не принимает изображения.` })
      }
      return selected
    }
    return this.autoModel(this.modelsCache, vision)
  }

  /** Extra credential values the user saved (account ID, endpoint, …). */
  protected fieldValues(): Record<string, string> {
    return this.deps.getFields?.() ?? {}
  }

  private missingFields(): string[] {
    const values = this.fieldValues()
    return extraFields(this.id)
      .filter((f) => f.required && !values[f.id]?.trim())
      .map((f) => f.id)
  }

  protected usableKeys(): { id: string; label: string; value: string }[] {
    const result: { id: string; label: string; value: string }[] = []
    for (const ref of this.deps.getKeys()) {
      const value = this.deps.secrets.get(ref.id) ?? this.deps.getLegacyKey?.(ref.id) ?? null
      if (value && value.trim()) result.push({ id: ref.id, label: ref.label, value: value.trim() })
    }
    return result
  }

  private async execute(request: VisionRequest | TextRequest): Promise<ProviderResult> {
    if (!this.deps.integrationEnabled) throw new ProviderError(this.id, 'UNSUPPORTED', { message: 'Интеграция отключена.' })
    const keys = this.usableKeys()
    if (keys.length === 0) throw new ProviderError(this.id, 'AUTH', { message: 'Ключ не добавлен.' })

    // Lazily learn the catalog once so Automatic can pick a model the account really has.
    if (!this.modelsCache) {
      try {
        this.modelsCache = await this.withSignal((signal) => this.listModels(keys[0].value, signal), request.signal)
        this.catalogError = null
      } catch (err) {
        const error = normalizeThrown(this.id, err)
        this.catalogError = error
        if (error.code === 'AUTH' || error.code === 'CANCELLED') throw error
        // The catalog is optional; fall back to documented defaults.
      }
    }
    const model = this.resolveModel(isVisionRequest(request))

    const now = this.now()
    const candidates = keys.filter((k) => (this.keyBlockedUntil.get(k.id) ?? 0) <= now)
    const ordered = candidates.length > 0 ? candidates : keys
    let lastError: ProviderError | null = null
    for (const key of ordered) {
      try {
        const result = await this.withSignal(
          (signal) => this.performRequest(key.value, model, request, signal),
          request.signal
        )
        this.keyBlockedUntil.delete(key.id)
        if (result.rateLimits) {
          this.lastRateLimits = result.rateLimits
          if (keys.length > 1) result.rateLimitSource = `${result.rateLimitSource ?? ''} · ключ «${key.label}»`.trim()
        }
        return result
      } catch (err) {
        const error = normalizeThrown(this.id, err)
        lastError = error
        const retryMs = error.resetAt ?? (error.retryAfter !== undefined ? this.now() + error.retryAfter * 1000 : undefined)
        if (error.code === 'RATE_LIMIT') {
          this.keyBlockedUntil.set(key.id, retryMs ?? this.now() + KEY_RECHECK_MS.rate)
          continue
        }
        if (error.code === 'PLAN_LIMIT' || error.code === 'INSUFFICIENT_CREDITS') {
          this.keyBlockedUntil.set(key.id, retryMs ?? this.now() + KEY_RECHECK_MS.plan)
          continue
        }
        if (error.code === 'AUTH' || error.code === 'NO_PERMISSION') {
          this.keyBlockedUntil.set(key.id, this.now() + KEY_RECHECK_MS.plan)
          continue
        }
        throw error
      }
    }
    throw lastError ?? new ProviderError(this.id, 'UNKNOWN')
  }

  /** Runs with a per-request timeout plus cancelRequest() support. */
  protected async withSignal<T>(fn: (signal: AbortSignal) => Promise<T>, external?: AbortSignal): Promise<T> {
    const controller = new AbortController()
    this.controllers.add(controller)
    const timeout = AbortSignal.timeout(this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const signals = [controller.signal, timeout, ...(external ? [external] : [])]
    const signal = AbortSignal.any(signals)
    try {
      return await fn(signal)
    } catch (err) {
      if (timeout.aborted) throw new ProviderError(this.id, 'TIMEOUT', { originalError: err })
      if (controller.signal.aborted || external?.aborted) throw new ProviderError(this.id, 'CANCELLED', { originalError: err })
      throw normalizeThrown(this.id, err)
    } finally {
      this.controllers.delete(controller)
    }
  }

  /** fetch + JSON with network errors normalized. Never logs bodies or keys. */
  protected async http(url: string, init: RequestInit, signal: AbortSignal): Promise<HttpResponse> {
    let response: Response
    try {
      response = await this.fetchImpl(url, { ...init, signal, redirect: this.redirectMode })
    } catch (err) {
      if (signal.aborted) throw err
      throw normalizeThrown(this.id, err)
    }
    let body: unknown = null
    const text = await response.text().catch(() => '')
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
    }
    return { status: response.status, headers: response.headers, body }
  }

  /** Default HTTP error mapping; subclasses refine by provider error codes. */
  protected httpError(response: HttpResponse, extra: { retryAfter?: number; resetAt?: number; message?: string } = {}): ProviderError {
    return new ProviderError(this.id, codeFromHttpStatus(response.status), {
      status: response.status,
      ...extra
    })
  }
}

/** Removes reasoning blocks some models (Qwen on Groq) emit before the answer. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}
