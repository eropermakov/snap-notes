import type { ModelInfo } from '../../../shared/providers'
import { ProviderError } from '../errors'
import { getHeader, parseAnthropicRateLimits, parseRetryAfter } from '../rateLimits'
import { ANTHROPIC_DEFAULT_MODEL, anthropicModelFromListing, pickModel } from '../modelCatalog'
import type { ProviderResult, TextRequest, VisionRequest } from '../types'
import { isVisionRequest } from '../types'
import { ApiKeyProvider, type HttpResponse } from './apiKeyProvider'

const API = 'https://api.anthropic.com/v1'
const API_VERSION = '2023-06-01'

/** Anthropic API with the user's own API key (Claude Console). This is NOT a Claude Pro/Max subscription. */
export class AnthropicApiProvider extends ApiKeyProvider {
  readonly id = 'anthropic' as const
  readonly name = 'Anthropic API'

  protected integrationNote(): string | undefined {
    return this.deps.integrationEnabled ? undefined : 'Интеграция Anthropic API отключена в этой сборке.'
  }

  private headers(apiKey: string): Record<string, string> {
    return { 'x-api-key': apiKey, 'anthropic-version': API_VERSION, 'content-type': 'application/json' }
  }

  protected async listModels(apiKey: string, signal: AbortSignal): Promise<ModelInfo[]> {
    const response = await this.http(`${API}/models?limit=100`, { headers: this.headers(apiKey) }, signal)
    if (response.status !== 200) throw this.toError(response)
    const data = (response.body as { data?: { id?: unknown; display_name?: unknown }[] })?.data
    if (!Array.isArray(data)) throw new ProviderError(this.id, 'INVALID_RESPONSE')
    return data
      .map((m) =>
        typeof m?.id === 'string' ? anthropicModelFromListing(m.id, typeof m.display_name === 'string' ? m.display_name : undefined) : null
      )
      .filter((m): m is ModelInfo => m !== null)
  }

  protected autoModel(models: ModelInfo[] | null, vision: boolean): string {
    return pickModel(models, ANTHROPIC_DEFAULT_MODEL, vision)
  }

  protected modelVision(modelId: string): boolean | undefined {
    return anthropicModelFromListing(modelId)?.vision
  }

  protected async performRequest(
    apiKey: string,
    model: string,
    request: VisionRequest | TextRequest,
    signal: AbortSignal
  ): Promise<ProviderResult> {
    const content: unknown[] = []
    if (isVisionRequest(request)) {
      content.push({ type: 'image', source: { type: 'base64', media_type: request.mimeType, data: request.image.toString('base64') } })
    }
    content.push({ type: 'text', text: request.prompt })
    const response = await this.http(
      `${API}/messages`,
      {
        method: 'POST',
        headers: this.headers(apiKey),
        body: JSON.stringify({
          model,
          max_tokens: 8192,
          ...(request.instructions ? { system: request.instructions } : {}),
          messages: [{ role: 'user', content }]
        })
      },
      signal
    )
    const rateLimits = parseAnthropicRateLimits(response.headers, this.now())
    if (rateLimits.length) this.lastRateLimits = rateLimits
    if (response.status !== 200) throw this.toError(response)

    const parsed = response.body as {
      content?: { type?: string; text?: string }[]
      usage?: { input_tokens?: number; output_tokens?: number }
    }
    const text = (parsed?.content ?? [])
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text as string)
      .join('')
    if (!Array.isArray(parsed?.content)) throw new ProviderError(this.id, 'INVALID_RESPONSE')
    const input = parsed.usage?.input_tokens
    const output = parsed.usage?.output_tokens
    return {
      text,
      model,
      usage: {
        inputTokens: input,
        outputTokens: output,
        totalTokens: input !== undefined && output !== undefined ? input + output : undefined
      },
      rateLimits,
      rateLimitSource: 'заголовки anthropic-ratelimit-*'
    }
  }

  private toError(response: HttpResponse): ProviderError {
    const error = (response.body as { error?: { type?: unknown; details?: { error_code?: unknown } } })?.error
    const type = typeof error?.type === 'string' ? error.type : ''
    const detailCode = typeof error?.details?.error_code === 'string' ? error.details.error_code : ''
    const retryAfter = parseRetryAfter(getHeader(response.headers, 'retry-after'), this.now())
    // Spend cap: rate_limit_error without retry-after, identified by details.error_code (Anthropic docs).
    if (detailCode === 'enforced_spend_limit_reached') {
      return new ProviderError(this.id, 'INSUFFICIENT_CREDITS', { status: response.status })
    }
    if (type === 'billing_error') return new ProviderError(this.id, 'INSUFFICIENT_CREDITS', { status: response.status })
    if (type === 'authentication_error') return new ProviderError(this.id, 'AUTH', { status: response.status })
    if (type === 'permission_error') return new ProviderError(this.id, 'NO_PERMISSION', { status: response.status })
    if (type === 'not_found_error') return new ProviderError(this.id, 'MODEL_UNAVAILABLE', { status: response.status })
    if (type === 'overloaded_error' || response.status === 529) {
      return new ProviderError(this.id, 'PROVIDER_DOWN', { status: response.status, ...(retryAfter !== undefined ? { retryAfter } : {}) })
    }
    if (response.status === 429 || type === 'rate_limit_error') {
      return new ProviderError(this.id, 'RATE_LIMIT', { status: response.status, ...(retryAfter !== undefined ? { retryAfter } : {}) })
    }
    return this.httpError(response, retryAfter !== undefined ? { retryAfter } : {})
  }
}
