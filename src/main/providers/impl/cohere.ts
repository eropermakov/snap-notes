import type { ModelInfo, ProviderCapabilities, ProviderUsage } from '../../../shared/providers'
import { ProviderError } from '../errors'
import { getHeader, parseCohereTrialLimits, parseRetryAfter } from '../rateLimits'
import { pickPreferred, errorMessage } from './openaiCompatible'
import type { ProviderResult, TextRequest, VisionRequest } from '../types'
import { isVisionRequest } from '../types'
import { API_CAPABILITIES, ApiKeyProvider, stripThinking, type HttpResponse } from './apiKeyProvider'

const BASE = 'https://api.cohere.com'
/** Last resort when the catalog cannot be read. Normal choice comes from the account's model list. */
const FALLBACK_TEXT_MODEL = 'command-a-03-2025'
const NOT_FOR_OCR_TEXT = /vision|reasoning|translate|arabic|embed|rerank|classify|audio/i

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

export function parseCohereModels(body: unknown): ModelInfo[] {
  const list = Array.isArray(asObject(body).models) ? (asObject(body).models as unknown[]) : []
  const models: ModelInfo[] = []
  for (const raw of list) {
    const m = asObject(raw)
    const id = typeof m.name === 'string' ? m.name : ''
    if (!id) continue
    const endpoints = Array.isArray(m.endpoints) ? (m.endpoints as unknown[]) : []
    if (endpoints.length > 0 && !endpoints.includes('chat')) continue
    const features = Array.isArray(m.features) ? (m.features as unknown[]) : []
    const vision = /vision/i.test(id) || features.some((f) => typeof f === 'string' && /vision|image/i.test(f))
    models.push({
      id,
      displayName: id,
      vision,
      ...(typeof m.context_length === 'number' ? { contextLength: m.context_length } : {}),
      ...(features.includes('json_mode') || features.includes('json_schema') ? { structured: true } : {})
    })
  }
  return models.sort((a, b) => a.id.localeCompare(b.id))
}

const CAPABILITIES: ProviderCapabilities = { ...API_CAPABILITIES, vision: true, ocr: false }

/**
 * Cohere (native v2 chat). A text provider first: Tesseract → Cohere → cleanup/structure. Images
 * are sent only to models whose catalog entry says they accept them.
 */
export class CohereProvider extends ApiKeyProvider {
  readonly id = 'cohere' as const
  readonly name = 'Cohere'
  protected capabilities = CAPABILITIES

  protected integrationNote(): string | undefined {
    return this.deps.integrationEnabled ? undefined : 'Интеграция Cohere отключена в этой сборке.'
  }

  private headers(apiKey: string): Record<string, string> {
    return { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'x-client-name': 'snap-notes' }
  }

  protected async listModels(apiKey: string, signal: AbortSignal): Promise<ModelInfo[]> {
    const response = await this.http(`${BASE}/v1/models?endpoint=chat&page_size=100`, { headers: this.headers(apiKey) }, signal)
    if (response.status !== 200) throw this.toError(response)
    return parseCohereModels(response.body)
  }

  protected autoModel(models: ModelInfo[] | null, vision: boolean): string {
    const known = models && models.length > 0
    if (vision) {
      const pick = (models ?? []).find((m) => m.vision === true)
      if (!pick) throw new ProviderError(this.id, 'UNSUPPORTED', { message: 'У Cohere нет модели с поддержкой изображений.' })
      return pick.id
    }
    const ranked = pickPreferred(models, [/^command-a-\d/, /^command-a-/, /^command-r-plus/, /^command-r/], (m) => m.vision !== true && !NOT_FOR_OCR_TEXT.test(m.id))
    return known && ranked.length ? ranked[0] : FALLBACK_TEXT_MODEL
  }

  protected modelVision(modelId: string, models: ModelInfo[] | null): boolean | undefined {
    return models?.find((m) => m.id === modelId)?.vision ?? (/vision/i.test(modelId) ? true : undefined)
  }

  async canServeVision(): Promise<boolean> {
    const selected = this.deps.getModel()
    if (!selected || selected === 'auto') return (this.modelsCache ?? []).some((m) => m.vision === true)
    return this.modelVision(selected, this.modelsCache) === true
  }

  protected async performRequest(
    apiKey: string,
    model: string,
    request: VisionRequest | TextRequest,
    signal: AbortSignal
  ): Promise<ProviderResult> {
    const vision = isVisionRequest(request)
    const content = vision
      ? [
          { type: 'text', text: request.prompt },
          { type: 'image_url', image_url: { url: `data:${request.mimeType};base64,${request.image.toString('base64')}` } }
        ]
      : request.prompt
    const messages = [...(request.instructions ? [{ role: 'system', content: request.instructions }] : []), { role: 'user', content }]
    const send = (json: boolean): Promise<HttpResponse> =>
      this.http(
        `${BASE}/v2/chat`,
        {
          method: 'POST',
          headers: this.headers(apiKey),
          body: JSON.stringify({ model, messages, max_tokens: 4000, stream: false, ...(json ? { response_format: { type: 'json_object' } } : {}) })
        },
        signal
      )
    let response = await send(request.json === true)
    if (request.json && (response.status === 400 || response.status === 422) && /response_format|json/i.test(errorMessage(response.body))) {
      response = await send(false)
    }
    const rateLimits = parseCohereTrialLimits(response.headers, this.now())
    if (rateLimits.length) this.lastRateLimits = rateLimits
    if (response.status !== 200) throw this.toError(response)

    const body = asObject(response.body)
    const parts = Array.isArray(asObject(body.message).content) ? (asObject(body.message).content as unknown[]) : []
    const text = parts
      .map((p) => (asObject(p).type === 'text' && typeof asObject(p).text === 'string' ? (asObject(p).text as string) : ''))
      .join('')
    if (!text.trim()) throw new ProviderError(this.id, 'INVALID_RESPONSE')
    const tokens = asObject(asObject(body.usage).tokens)
    return {
      text: stripThinking(text),
      model,
      usage: {
        inputTokens: typeof tokens.input_tokens === 'number' ? tokens.input_tokens : undefined,
        outputTokens: typeof tokens.output_tokens === 'number' ? tokens.output_tokens : undefined
      },
      ...(rateLimits.length ? { rateLimits, rateLimitSource: 'заголовки Trial-ключа Cohere' } : {})
    }
  }

  private toError(response: HttpResponse): ProviderError {
    const message = errorMessage(response.body)
    const retryAfter = parseRetryAfter(getHeader(response.headers, 'retry-after'), this.now())
    if (response.status === 429) {
      // A Trial key also stops at its monthly call limit; the reset date is not reported, so none is shown.
      if (/trial key|per month|monthly|1,?000 api calls/i.test(message)) {
        return new ProviderError(this.id, 'PLAN_LIMIT', { status: 429, message: 'Месячный лимит Trial-ключа Cohere исчерпан.' })
      }
      return new ProviderError(this.id, 'RATE_LIMIT', { status: 429, ...(retryAfter !== undefined ? { retryAfter } : {}) })
    }
    if (response.status === 404 || (response.status === 400 && /model/i.test(message) && /not found|unknown|deprecated|removed/i.test(message))) {
      return new ProviderError(this.id, 'MODEL_UNAVAILABLE', { status: response.status })
    }
    return this.httpError(response, retryAfter !== undefined ? { retryAfter } : {})
  }

  async getUsage(): Promise<Partial<ProviderUsage> | null> {
    return {
      source: 'Cohere',
      accuracy: 'unknown',
      windows: [],
      note: 'Trial-ключ: бесплатно с ограничениями, не для продакшена. Остаток Cohere через API не отдаёт.'
    }
  }
}
