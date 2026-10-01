import type { ModelInfo } from '../../../shared/providers'
import { ProviderError } from '../errors'
import { getHeader, parseGroqRateLimits, parseRetryAfter } from '../rateLimits'
import { GROQ_VISION_MODELS, groqModelFromListing, pickGroqModel } from '../modelCatalog'
import type { ProviderResult, TextRequest, VisionRequest } from '../types'
import { isVisionRequest } from '../types'
import { ApiKeyProvider, stripThinking, type HttpResponse } from './apiKeyProvider'

const API = 'https://api.groq.com/openai/v1'

export class GroqProvider extends ApiKeyProvider {
  readonly id = 'groq' as const
  readonly name = 'Groq'

  protected integrationNote(): string | undefined {
    return this.deps.integrationEnabled ? undefined : 'Интеграция Groq отключена в этой сборке.'
  }

  protected async listModels(apiKey: string, signal: AbortSignal): Promise<ModelInfo[]> {
    const response = await this.http(`${API}/models`, { headers: { authorization: `Bearer ${apiKey}` } }, signal)
    const rateLimits = parseGroqRateLimits(response.headers, this.now())
    if (rateLimits.length) this.lastRateLimits = rateLimits
    if (response.status !== 200) throw this.toError(response)
    const data = (response.body as { data?: { id?: unknown; active?: unknown }[] })?.data
    if (!Array.isArray(data)) throw new ProviderError(this.id, 'INVALID_RESPONSE')
    const models = data
      .map((m) => (typeof m?.id === 'string' ? groqModelFromListing(m.id, m.active === false ? false : undefined) : null))
      .filter((m): m is ModelInfo => m !== null)
    // Vision models first, in documented order; the rest alphabetically.
    return models.sort((a, b) => {
      const ai = GROQ_VISION_MODELS.indexOf(a.id)
      const bi = GROQ_VISION_MODELS.indexOf(b.id)
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
      return a.id.localeCompare(b.id)
    })
  }

  protected autoModel(models: ModelInfo[] | null, vision: boolean): string {
    return pickGroqModel(models, vision)
  }

  protected modelVision(modelId: string): boolean | undefined {
    return GROQ_VISION_MODELS.includes(modelId)
  }

  protected async performRequest(
    apiKey: string,
    model: string,
    request: VisionRequest | TextRequest,
    signal: AbortSignal
  ): Promise<ProviderResult> {
    const userContent = isVisionRequest(request)
      ? [
          { type: 'text', text: request.prompt },
          { type: 'image_url', image_url: { url: `data:${request.mimeType};base64,${request.image.toString('base64')}` } }
        ]
      : request.prompt
    const messages = [
      ...(request.instructions ? [{ role: 'system', content: request.instructions }] : []),
      { role: 'user', content: userContent }
    ]
    const response = await this.http(
      `${API}/chat/completions`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          max_completion_tokens: 8192,
          ...(request.json ? { response_format: { type: 'json_object' } } : {})
        })
      },
      signal
    )
    const rateLimits = parseGroqRateLimits(response.headers, this.now())
    if (rateLimits.length) this.lastRateLimits = rateLimits
    if (response.status !== 200) throw this.toError(response)

    const parsed = response.body as {
      choices?: { message?: { content?: unknown } }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    }
    const content = parsed?.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new ProviderError(this.id, 'INVALID_RESPONSE')
    return {
      text: stripThinking(content),
      model,
      usage: {
        inputTokens: parsed.usage?.prompt_tokens,
        outputTokens: parsed.usage?.completion_tokens,
        totalTokens: parsed.usage?.total_tokens
      },
      rateLimits,
      rateLimitSource: 'заголовки x-ratelimit-* Groq'
    }
  }

  private toError(response: HttpResponse): ProviderError {
    const error = (response.body as { error?: { code?: unknown; type?: unknown } })?.error
    const code = typeof error?.code === 'string' ? error.code : ''
    const retryAfter = parseRetryAfter(getHeader(response.headers, 'retry-after'), this.now())
    if (code === 'model_not_found' || code === 'model_decommissioned') {
      return new ProviderError(this.id, 'MODEL_UNAVAILABLE', { status: response.status })
    }
    if (code === 'invalid_api_key') return new ProviderError(this.id, 'AUTH', { status: response.status })
    if (code === 'json_validate_failed') return new ProviderError(this.id, 'INVALID_RESPONSE', { status: response.status })
    if (response.status === 429) {
      const exhausted = parseGroqRateLimits(response.headers, this.now()).find((w) => w.remaining === 0 && w.resetAt)
      return new ProviderError(this.id, 'RATE_LIMIT', {
        status: 429,
        ...(retryAfter !== undefined ? { retryAfter } : exhausted?.resetAt ? { resetAt: exhausted.resetAt } : {})
      })
    }
    return this.httpError(response, retryAfter !== undefined ? { retryAfter } : {})
  }
}
