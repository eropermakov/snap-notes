import type { ModelInfo } from '../../../shared/providers'
import { ProviderError } from '../errors'
import { getHeader, parseOpenAiRateLimits, parseRetryAfter } from '../rateLimits'
import { OPENAI_DEFAULT_MODEL, openAiModelFromListing, pickModel } from '../modelCatalog'
import type { ProviderResult, TextRequest, VisionRequest } from '../types'
import { isVisionRequest } from '../types'
import { ApiKeyProvider, type HttpResponse } from './apiKeyProvider'

const API = 'https://api.openai.com/v1'

/** OpenAI API with the user's own API key (pay-as-you-go). This is NOT the ChatGPT plan. */
export class OpenAiApiProvider extends ApiKeyProvider {
  readonly id = 'openai' as const
  readonly name = 'OpenAI API'

  protected integrationNote(): string | undefined {
    return this.deps.integrationEnabled ? undefined : 'Интеграция OpenAI API отключена в этой сборке.'
  }

  protected async listModels(apiKey: string, signal: AbortSignal): Promise<ModelInfo[]> {
    const response = await this.http(`${API}/models`, { headers: { authorization: `Bearer ${apiKey}` } }, signal)
    if (response.status !== 200) throw this.toError(response)
    const data = (response.body as { data?: { id?: unknown }[] })?.data
    if (!Array.isArray(data)) throw new ProviderError(this.id, 'INVALID_RESPONSE')
    return data
      .map((m) => (typeof m?.id === 'string' ? openAiModelFromListing(m.id) : null))
      .filter((m): m is ModelInfo => m !== null)
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  protected autoModel(models: ModelInfo[] | null, vision: boolean): string {
    return pickModel(models, OPENAI_DEFAULT_MODEL, vision)
  }

  protected modelVision(modelId: string, models: ModelInfo[] | null): boolean | undefined {
    return models?.find((m) => m.id === modelId)?.vision ?? openAiModelFromListing(modelId)?.vision
  }

  protected async performRequest(
    apiKey: string,
    model: string,
    request: VisionRequest | TextRequest,
    signal: AbortSignal
  ): Promise<ProviderResult> {
    const content: unknown[] = [{ type: 'input_text', text: request.prompt }]
    if (isVisionRequest(request)) {
      content.push({ type: 'input_image', image_url: `data:${request.mimeType};base64,${request.image.toString('base64')}` })
    }
    const body = {
      model,
      input: [{ role: 'user', content }],
      ...(request.instructions ? { instructions: request.instructions } : {}),
      ...(request.json ? { text: { format: { type: 'json_object' } } } : {}),
      store: false
    }
    const response = await this.http(
      `${API}/responses`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body)
      },
      signal
    )
    const rateLimits = parseOpenAiRateLimits(response.headers, this.now())
    if (rateLimits.length) this.lastRateLimits = rateLimits
    if (response.status !== 200) throw this.toError(response)

    const parsed = response.body as {
      output?: { type?: string; content?: { type?: string; text?: string }[] }[]
      usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }
      status?: string
    }
    const text = (parsed?.output ?? [])
      .filter((item) => item?.type === 'message')
      .flatMap((item) => item.content ?? [])
      .filter((part) => part?.type === 'output_text' && typeof part.text === 'string')
      .map((part) => part.text as string)
      .join('')
    if (!text && parsed?.status !== 'completed') throw new ProviderError(this.id, 'INVALID_RESPONSE')
    return {
      text,
      model,
      usage: {
        inputTokens: parsed?.usage?.input_tokens,
        outputTokens: parsed?.usage?.output_tokens,
        totalTokens: parsed?.usage?.total_tokens
      },
      rateLimits,
      rateLimitSource: 'заголовки x-ratelimit-* OpenAI'
    }
  }

  private toError(response: HttpResponse): ProviderError {
    const error = (response.body as { error?: { code?: unknown; type?: unknown } })?.error
    const code = typeof error?.code === 'string' ? error.code : typeof error?.type === 'string' ? error.type : ''
    const retryAfter = parseRetryAfter(getHeader(response.headers, 'retry-after'), this.now())
    if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') {
      return new ProviderError(this.id, 'INSUFFICIENT_CREDITS', { status: response.status })
    }
    if (code === 'model_not_found') return new ProviderError(this.id, 'MODEL_UNAVAILABLE', { status: response.status })
    if (code === 'invalid_api_key') return new ProviderError(this.id, 'AUTH', { status: response.status })
    if (response.status === 429) {
      // Without retry-after, use the reset of whichever reported window is exhausted.
      const exhausted = parseOpenAiRateLimits(response.headers, this.now()).find((w) => w.remaining === 0 && w.resetAt)
      return new ProviderError(this.id, 'RATE_LIMIT', {
        status: 429,
        ...(retryAfter !== undefined ? { retryAfter } : exhausted?.resetAt ? { resetAt: exhausted.resetAt } : {})
      })
    }
    return this.httpError(response, retryAfter !== undefined ? { retryAfter } : {})
  }
}
