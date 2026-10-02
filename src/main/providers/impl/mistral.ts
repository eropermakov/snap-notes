import type { ModelInfo } from '../../../shared/providers'
import { ProviderError } from '../errors'
import { getHeader, parseOpenAiRateLimits, parseRetryAfter } from '../rateLimits'
import type { ProviderResult, TextRequest, VisionRequest } from '../types'
import { isVisionRequest } from '../types'
import { API_CAPABILITIES, type ApiKeyProviderDeps, type HttpResponse } from './apiKeyProvider'
import { errorMessage, OpenAICompatibleProvider, pickPreferred, type OpenAICompatConfig } from './openaiCompatible'

const BASE = 'https://api.mistral.ai/v1'
const NOT_FOR_CHAT = /embed|moderation|codestral|voxtral|devstral|transcribe|classif/i
const OCR_BLOCK_MS = 30 * 60_000

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

export function parseMistralModels(body: unknown): ModelInfo[] {
  const list = Array.isArray(asObject(body).data) ? (asObject(body).data as unknown[]) : []
  const seen = new Set<string>()
  const models: ModelInfo[] = []
  for (const raw of list) {
    const m = asObject(raw)
    const id = typeof m.id === 'string' ? m.id : ''
    if (!id || seen.has(id)) continue
    const caps = asObject(m.capabilities)
    const isOcr = caps.ocr === true || /ocr/i.test(id)
    if (!isOcr && (caps.completion_chat === false || NOT_FOR_CHAT.test(id))) continue
    seen.add(id)
    models.push({
      id,
      displayName: typeof m.name === 'string' && m.name ? m.name : id,
      ...(isOcr || caps.vision === true ? { vision: true } : caps.vision === false ? { vision: false } : {}),
      ...(typeof m.max_context_length === 'number' ? { contextLength: m.max_context_length } : {})
    })
  }
  return models.sort((a, b) => a.id.localeCompare(b.id))
}

export const MISTRAL_CONFIG: OpenAICompatConfig = {
  id: 'mistral',
  name: 'Mistral',
  baseUrl: BASE,
  capabilities: { ...API_CAPABILITIES, ocr: true },
  modelDiscovery: { parse: parseMistralModels },
  rateLimitParser: (headers, now) => parseOpenAiRateLimits(headers, now).filter((w) => !w.id.startsWith('project-')),
  rateLimitSource: 'заголовки x-ratelimit-* Mistral',
  autoModels: (models, vision) => {
    if (vision) {
      const ocr = pickPreferred(models, [/ocr-latest$/, /ocr/], (m) => /ocr/i.test(m.id))
      return ocr.length ? ocr : ['mistral-ocr-latest']
    }
    return pickPreferred(models, [/^mistral-small-latest$/, /^mistral-medium-latest$/, /small/, /medium/], (m) => !/ocr/i.test(m.id) && !NOT_FOR_CHAT.test(m.id))
  },
  modelVision: (id) => (/ocr/i.test(id) ? true : undefined)
}

/**
 * Mistral: chat models through the OpenAI-compatible client, plus the official OCR endpoint
 * (POST /v1/ocr) for screenshots. OCR returns Markdown, which the recognition service turns into
 * note blocks locally. If the account cannot use OCR, vision requests are skipped for a while so
 * text requests keep working.
 */
export class MistralProvider extends OpenAICompatibleProvider {
  private ocrBlockedUntil = 0

  constructor(deps: ApiKeyProviderDeps) {
    super(MISTRAL_CONFIG, deps)
  }

  async canServeVision(imageBytes?: number): Promise<boolean> {
    const selected = this.deps.getModel()
    const usesOcr = !selected || selected === 'auto' || /ocr/i.test(selected)
    if (usesOcr && this.ocrBlockedUntil > this.now()) return false
    return super.canServeVision(imageBytes)
  }

  protected async performRequest(
    apiKey: string,
    model: string,
    request: VisionRequest | TextRequest,
    signal: AbortSignal
  ): Promise<ProviderResult> {
    if (isVisionRequest(request) && /ocr/i.test(model)) return this.runOcr(apiKey, model, request, signal)
    return super.performRequest(apiKey, model, request, signal)
  }

  private async runOcr(apiKey: string, model: string, request: VisionRequest, signal: AbortSignal): Promise<ProviderResult> {
    const response = await this.http(
      `${BASE}/ocr`,
      {
        method: 'POST',
        headers: this.requestHeaders(apiKey),
        body: JSON.stringify({
          model,
          document: { type: 'image_url', image_url: `data:${request.mimeType};base64,${request.image.toString('base64')}` },
          table_format: 'markdown',
          include_image_base64: false
        })
      },
      signal
    )
    const rateLimits = MISTRAL_CONFIG.rateLimitParser!(response.headers, this.now())
    if (rateLimits.length) this.lastRateLimits = rateLimits
    if (response.status !== 200) throw this.ocrError(response)

    const pages = asObject(response.body).pages
    if (!Array.isArray(pages)) throw new ProviderError(this.id, 'INVALID_RESPONSE')
    const markdown = pages
      .map((p) => asObject(p).markdown)
      .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      .join('\n\n')
    if (!markdown.trim()) throw new ProviderError(this.id, 'INVALID_RESPONSE', { message: 'Mistral OCR не нашёл текста.' })
    return {
      text: markdown,
      model,
      format: 'markdown',
      ...(rateLimits.length ? { rateLimits, rateLimitSource: MISTRAL_CONFIG.rateLimitSource } : {})
    }
  }

  private ocrError(response: HttpResponse): ProviderError {
    const status = response.status
    if (status === 402 || status === 403 || status === 404) {
      // OCR is not available for this account/plan. Not an auth failure: text requests still work.
      this.ocrBlockedUntil = this.now() + OCR_BLOCK_MS
      return new ProviderError(this.id, 'MODEL_UNAVAILABLE', { status, message: 'Mistral OCR недоступен для этого аккаунта или плана.' })
    }
    if (status === 400 || status === 422) {
      return new ProviderError(this.id, 'INVALID_RESPONSE', { status, message: errorMessage(response.body) || undefined })
    }
    if (status === 429) {
      const retryAfter = parseRetryAfter(getHeader(response.headers, 'retry-after'), this.now())
      return new ProviderError(this.id, 'RATE_LIMIT', { status, ...(retryAfter !== undefined ? { retryAfter } : {}) })
    }
    return this.toError(response)
  }
}
