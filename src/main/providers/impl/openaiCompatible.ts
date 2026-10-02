import type {
  ApiKeyProviderId,
  ModelInfo,
  ProviderCapabilities,
  ProviderUsage,
  UsageWindow
} from '../../../shared/providers'
import { ProviderError } from '../errors'
import { getHeader, parseRetryAfter } from '../rateLimits'
import type { HealthCheckResult, ProviderResult, TextRequest, VisionRequest } from '../types'
import { isVisionRequest } from '../types'
import { ApiKeyProvider, stripThinking, type ApiKeyProviderDeps, type HttpResponse } from './apiKeyProvider'

export interface CompatContext {
  apiKey: string
  fields: Record<string, string>
  signal: AbortSignal
  now: number
  http: (url: string, init: RequestInit) => Promise<HttpResponse>
}

/**
 * Everything that differs between OpenAI-compatible providers. A new compatible provider is one
 * of these objects (plus its entry in providerCatalog.ts): no request, retry or error code.
 */
export interface OpenAICompatConfig {
  id: ApiKeyProviderId
  name: string
  /** Root of the OpenAI-style API (…/v1). May depend on saved fields (Cloudflare account ID). */
  baseUrl: string | ((fields: Record<string, string>) => string)
  /** Default is Authorization: Bearer <key>. */
  headers?: (apiKey: string, fields: Record<string, string>) => Record<string, string>
  capabilities: ProviderCapabilities
  /** Where and how the model catalog is read. Models are never hardcoded as the only truth. */
  modelDiscovery: {
    /** Full URL of the listing; default `${baseUrl}/models`. */
    url?: (baseUrl: string, fields: Record<string, string>) => string
    parse: (body: unknown) => ModelInfo[]
  }
  /** Reads provider-reported rate-limit headers (only what the provider really sends). */
  rateLimitParser?: (headers: Headers, now: number) => UsageWindow[]
  /** Source label shown under the usage numbers. */
  rateLimitSource?: string
  /**
   * Ranked model ids for Automatic (best first). Empty = nothing suitable (e.g. no vision model),
   * which makes the router use the Tesseract → text path instead of sending an image.
   * `models` is null while the catalog is unknown.
   */
  autoModels: (models: ModelInfo[] | null, vision: boolean, json: boolean) => string[]
  /** Whether a specific model accepts images: true/false when known, undefined when unknown. */
  modelVision?: (modelId: string, models: ModelInfo[] | null) => boolean | undefined
  /** 'none' = never send response_format (the prompt already demands JSON). */
  jsonMode?: 'json_object' | 'none'
  maxTokens?: number
  /** Name of the output-limit parameter; Cerebras prefers max_completion_tokens. */
  maxTokensParam?: 'max_tokens' | 'max_completion_tokens'
  /** Inline-image limit (base64 characters). Larger screenshots are declined before any request. */
  maxInlineImageChars?: number
  timeoutMs?: number
  /** Real authenticated call used by "Test connection" when the model listing is public. */
  authCheck?: (ctx: CompatContext) => Promise<void>
  /** Provider-specific error refinement; return null to use the generic mapping. */
  mapError?: (response: HttpResponse, now: number) => ProviderError | null
  /** Usage facts that need a (free) request, e.g. OpenRouter GET /key. Returns null when none. */
  fetchUsage?: (ctx: CompatContext) => Promise<Partial<ProviderUsage> | null>
  /** Documented usage facts that need no request (free allocation text, reset rule). */
  staticUsage?: (now: number) => Partial<ProviderUsage> | null
  /** Extra JSON body fields, e.g. OpenRouter's `models` fallback list. */
  extraBody?: (model: string, ranked: string[], vision: boolean) => Record<string, unknown>
  /** Replaces the user prompt for image requests (dedicated OCR endpoints ignore the JSON schema). */
  imagePrompt?: string
  /** Mark image results as Markdown so they are converted to note blocks locally. */
  imageResultFormat?: 'markdown'
  /** Whether the provider answers plain-text requests (OCR-only endpoints do not). */
  textModels?: boolean
  /** Follow redirects (Modal answers long requests with a 303 to its own host). Default: refuse. */
  followRedirects?: boolean
}

const DEFAULT_MAX_TOKENS = 8192

/** First catalog model matching the patterns, in pattern order; then `fallback(models)`. */
export function pickPreferred(
  models: ModelInfo[] | null,
  patterns: RegExp[],
  accept: (m: ModelInfo) => boolean = () => true
): string[] {
  const pool = (models ?? []).filter(accept)
  const ranked: string[] = []
  for (const pattern of patterns) {
    for (const m of pool) if (pattern.test(m.id) && !ranked.includes(m.id)) ranked.push(m.id)
  }
  for (const m of pool) if (!ranked.includes(m.id)) ranked.push(m.id)
  return ranked
}

export function errorMessage(body: unknown): string {
  const b = body as { error?: { message?: unknown } | string; message?: unknown; detail?: unknown } | string | null
  if (typeof b === 'string') return b.slice(0, 300)
  const errors = (b as { errors?: { message?: unknown }[] } | null)?.errors
  if (Array.isArray(errors) && typeof errors[0]?.message === 'string') return errors[0].message.slice(0, 300)
  const e = b?.error
  if (typeof e === 'string') return e.slice(0, 300)
  if (e && typeof e.message === 'string') return e.message.slice(0, 300)
  if (typeof b?.message === 'string') return b.message.slice(0, 300)
  if (typeof b?.detail === 'string') return b.detail.slice(0, 300)
  return ''
}

/** Text of an OpenAI-style message.content (string or array of parts). */
function contentText(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : ''))
      .join('')
    return text
  }
  return null
}

/**
 * Generic OpenAI Chat Completions provider. Handles auth, vision payloads, JSON mode (with an
 * automatic retry without it for models that reject response_format), rate-limit headers and
 * error classification. Provider specifics live in OpenAICompatConfig.
 */
export class OpenAICompatibleProvider extends ApiKeyProvider {
  readonly id: ApiKeyProviderId
  readonly name: string
  private usageCache: { at: number; value: Partial<ProviderUsage> | null } | null = null

  constructor(
    protected readonly config: OpenAICompatConfig,
    deps: ApiKeyProviderDeps
  ) {
    super({ ...deps, timeoutMs: deps.timeoutMs ?? config.timeoutMs })
    this.id = config.id
    this.name = config.name
    this.capabilities = config.capabilities
    if (config.followRedirects) this.redirectMode = 'follow'
  }

  protected integrationNote(): string | undefined {
    return this.deps.integrationEnabled ? undefined : `Интеграция ${this.name} отключена в этой сборке.`
  }

  // ---- URLs, headers --------------------------------------------------------------------------
  protected baseUrl(): string {
    const base = typeof this.config.baseUrl === 'function' ? this.config.baseUrl(this.fieldValues()) : this.config.baseUrl
    return base.replace(/\/+$/, '')
  }

  protected requestHeaders(apiKey: string, json = true): Record<string, string> {
    const headers = this.config.headers
      ? this.config.headers(apiKey, this.fieldValues())
      : { authorization: `Bearer ${apiKey}` }
    return json ? { ...headers, 'content-type': 'application/json' } : headers
  }

  protected context(apiKey: string, signal: AbortSignal): CompatContext {
    return {
      apiKey,
      fields: this.fieldValues(),
      signal,
      now: this.now(),
      http: (url, init) => this.http(url, { ...init, headers: { ...this.requestHeaders(apiKey, false), ...(init.headers as Record<string, string> | undefined) } }, signal)
    }
  }

  // ---- catalog ---------------------------------------------------------------------------------
  protected async listModels(apiKey: string, signal: AbortSignal): Promise<ModelInfo[]> {
    const base = this.baseUrl()
    const url = this.config.modelDiscovery.url ? this.config.modelDiscovery.url(base, this.fieldValues()) : `${base}/models`
    const response = await this.http(url, { headers: this.requestHeaders(apiKey, false) }, signal)
    if (response.status !== 200) throw this.toError(response)
    const models = this.config.modelDiscovery.parse(response.body)
    if (!Array.isArray(models)) throw new ProviderError(this.id, 'INVALID_RESPONSE')
    return models
  }

  private cachedModels(): ModelInfo[] | null {
    return this.modelsCache && this.modelsCache.length > 0 ? this.modelsCache : null
  }

  protected autoModel(models: ModelInfo[] | null, vision: boolean): string {
    if (!vision && this.config.textModels === false) {
      throw new ProviderError(this.id, 'UNSUPPORTED', { message: `${this.name} распознаёт только изображения.` })
    }
    const ranked = this.config.autoModels(models, vision, false)
    if (ranked.length === 0) {
      // No catalog because the service could not be reached: report that, not a missing model.
      if ((!models || models.length === 0) && this.catalogError) throw this.catalogError
      throw new ProviderError(this.id, vision ? 'UNSUPPORTED' : 'MODEL_UNAVAILABLE', {
        message: vision ? 'Нет модели с поддержкой изображений.' : 'Нет подходящей модели.'
      })
    }
    return ranked[0]
  }

  protected modelVision(modelId: string, models: ModelInfo[] | null): boolean | undefined {
    const listed = models?.find((m) => m.id === modelId)?.vision
    if (listed !== undefined) return listed
    return this.config.modelVision?.(modelId, models)
  }

  async canServeVision(imageBytes?: number): Promise<boolean> {
    if (!this.config.capabilities.vision) return false
    if (imageBytes !== undefined && this.config.maxInlineImageChars !== undefined) {
      if (Math.ceil(imageBytes / 3) * 4 > this.config.maxInlineImageChars) return false
    }
    const selected = this.deps.getModel()
    if (!selected || selected === 'auto') {
      return this.config.autoModels(this.cachedModels(), true, false).length > 0
    }
    return this.modelVision(selected, this.cachedModels()) !== false
  }

  // ---- requests --------------------------------------------------------------------------------
  protected async performRequest(
    apiKey: string,
    model: string,
    request: VisionRequest | TextRequest,
    signal: AbortSignal
  ): Promise<ProviderResult> {
    const vision = isVisionRequest(request)
    if (!vision && this.config.textModels === false) {
      throw new ProviderError(this.id, 'UNSUPPORTED', { message: `${this.name} распознаёт только изображения.` })
    }
    if (vision && this.config.maxInlineImageChars !== undefined) {
      if (Math.ceil(request.image.length / 3) * 4 > this.config.maxInlineImageChars) {
        throw new ProviderError(this.id, 'UNSUPPORTED', { message: 'Скриншот слишком велик для этого источника.' })
      }
    }
    const prompt = vision && this.config.imagePrompt ? this.config.imagePrompt : request.prompt
    const userContent = vision
      ? [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${request.mimeType};base64,${request.image.toString('base64')}` } }
        ]
      : prompt
    // With a fixed OCR prompt the instructions (JSON schema rules) do not apply.
    const instructions = vision && this.config.imagePrompt ? undefined : request.instructions
    const messages = [
      ...(instructions ? [{ role: 'system', content: instructions }] : []),
      { role: 'user', content: userContent }
    ]
    const wantsJson = request.json === true && this.config.jsonMode !== 'none' && !(vision && this.config.imagePrompt)
    const ranked = this.config.autoModels(this.cachedModels(), vision, request.json === true)
    const isAuto = (this.deps.getModel() || 'auto') === 'auto'
    const extra = this.config.extraBody?.(model, isAuto ? ranked : [model], vision) ?? {}

    const send = (json: boolean): Promise<HttpResponse> =>
      this.http(
        `${this.baseUrl()}/chat/completions`,
        {
          method: 'POST',
          headers: this.requestHeaders(apiKey),
          body: JSON.stringify({
            model,
            messages,
            [this.config.maxTokensParam ?? 'max_tokens']: this.config.maxTokens ?? DEFAULT_MAX_TOKENS,
            ...(json ? { response_format: { type: 'json_object' } } : {}),
            ...extra
          })
        },
        signal
      )

    let response = await send(wantsJson)
    if (wantsJson && (response.status === 400 || response.status === 422) && /response_format|json_object|json mode|structured/i.test(errorMessage(response.body))) {
      // This model has no JSON mode; the prompt itself asks for JSON, so ask again without it.
      response = await send(false)
    }
    const rateLimits = this.config.rateLimitParser ? this.config.rateLimitParser(response.headers, this.now()) : []
    if (rateLimits.length) this.lastRateLimits = rateLimits
    if (response.status !== 200) throw this.toError(response)

    const parsed = response.body as {
      choices?: { message?: { content?: unknown } }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
      model?: unknown
      error?: unknown
    }
    // Some gateways answer 200 with an error object (an upstream model failed).
    if (parsed?.error && !parsed.choices) throw this.toError({ status: 502, headers: response.headers, body: parsed })
    const content = contentText(parsed?.choices?.[0]?.message?.content)
    if (content === null || !content.trim()) throw new ProviderError(this.id, 'INVALID_RESPONSE')
    const usedModel = typeof parsed.model === 'string' && parsed.model ? parsed.model : model
    return {
      text: stripThinking(content),
      model: usedModel,
      usage: {
        inputTokens: parsed.usage?.prompt_tokens,
        outputTokens: parsed.usage?.completion_tokens,
        totalTokens: parsed.usage?.total_tokens
      },
      ...(vision && this.config.imageResultFormat ? { format: this.config.imageResultFormat } : {}),
      ...(rateLimits.length ? { rateLimits, rateLimitSource: this.config.rateLimitSource ?? 'заголовки ответа' } : {})
    }
  }

  // ---- errors ----------------------------------------------------------------------------------
  protected toError(response: HttpResponse): ProviderError {
    const now = this.now()
    const special = this.config.mapError?.(response, now)
    if (special) return special
    const message = errorMessage(response.body)
    const retryAfter = parseRetryAfter(getHeader(response.headers, 'retry-after'), now)
    const status = response.status

    if (status === 429) {
      const windows = this.config.rateLimitParser ? this.config.rateLimitParser(response.headers, now) : []
      const exhausted = windows.find((w) => w.remaining === 0 && w.resetAt)
      const longReset = exhausted?.resetAt !== undefined && exhausted.resetAt - now > 10 * 60_000
      const quotaText = /quota|credits?|billing|daily|per day|monthly|per month|exhausted/i.test(message)
      if (longReset || (quotaText && !/per minute|rpm|tpm/i.test(message))) {
        return new ProviderError(this.id, 'PLAN_LIMIT', {
          status,
          ...(retryAfter !== undefined ? { retryAfter } : exhausted?.resetAt ? { resetAt: exhausted.resetAt } : {})
        })
      }
      return new ProviderError(this.id, 'RATE_LIMIT', {
        status,
        ...(retryAfter !== undefined ? { retryAfter } : exhausted?.resetAt ? { resetAt: exhausted.resetAt } : {})
      })
    }
    if (status === 400 || status === 422) {
      if (/image|vision|multimodal|modalit/i.test(message) && /not support|unsupported|invalid|does not accept/i.test(message)) {
        return new ProviderError(this.id, 'UNSUPPORTED', { status, message: 'Модель не принимает изображения.' })
      }
      if (/model/i.test(message) && /not found|does not exist|unknown|unavailable|not available/i.test(message)) {
        return new ProviderError(this.id, 'MODEL_UNAVAILABLE', { status })
      }
      return new ProviderError(this.id, 'INVALID_RESPONSE', { status, message: message || undefined })
    }
    return this.httpError(response, retryAfter !== undefined ? { retryAfter } : {})
  }

  // ---- usage / health -------------------------------------------------------------------------
  async getUsage(): Promise<Partial<ProviderUsage> | null> {
    const now = this.now()
    const stat = this.config.staticUsage?.(now) ?? null
    const key = this.usableKeys()[0]
    let dynamic: Partial<ProviderUsage> | null = null
    if (key && this.config.fetchUsage) {
      if (this.usageCache && now - this.usageCache.at < 30_000) {
        dynamic = this.usageCache.value
      } else {
        try {
          dynamic = await this.withSignal((signal) => this.config.fetchUsage!(this.context(key.value, signal)))
        } catch {
          dynamic = null
        }
        this.usageCache = { at: now, value: dynamic }
      }
    }
    if (!stat && !dynamic) return null
    return { ...stat, ...dynamic }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const result = await this.checkConnection()
    if (result.ok) this.usageCache = null
    return result
  }

  private async checkConnection(): Promise<HealthCheckResult> {
    const key = this.usableKeys()[0]
    if (!key) return { ok: false, message: 'Ключ не добавлен.' }
    if (!(await this.isAvailable())) return { ok: false, message: 'Заполнены не все поля подключения.' }
    try {
      if (this.config.authCheck) {
        await this.withSignal((signal) => this.config.authCheck!(this.context(key.value, signal)))
      }
      const models = await this.getAvailableModels({ refresh: true })
      const vision = models.filter((m) => m.vision === true).length
      const free = models.filter((m) => m.free === true).length
      const parts = [`моделей: ${models.length}`]
      if (free) parts.push(`бесплатных: ${free}`)
      if (vision) parts.push(`с изображениями: ${vision}`)
      return { ok: true, message: `Подключено · ${parts.join(' · ')}` }
    } catch (err) {
      const error = err instanceof ProviderError ? err : new ProviderError(this.id, 'UNKNOWN', { originalError: err })
      return { ok: false, message: error.message, errorCode: error.code }
    }
  }
}
