import { GoogleGenAI } from '@google/genai'
import type { ModelInfo } from '../../../shared/providers'
import { ProviderError, codeFromHttpStatus, normalizeThrown } from '../errors'
import { nextPacificMidnight, parseGeminiQuotaError } from '../rateLimits'
import { GEMINI_DEFAULT_MODEL, geminiModelFromListing, pickModel } from '../modelCatalog'
import type { ProviderResult, TextRequest, VisionRequest } from '../types'
import { isVisionRequest } from '../types'
import { ApiKeyProvider, type ApiKeyProviderDeps } from './apiKeyProvider'

/** The slice of @google/genai used here, so tests can substitute a fake client. */
export interface GeminiClientLike {
  models: {
    generateContent(params: {
      model: string
      contents: unknown
      config?: { responseMimeType?: string; systemInstruction?: string; abortSignal?: AbortSignal }
    }): Promise<{
      text?: string
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
    }>
    list(params?: { config?: { pageSize?: number; abortSignal?: AbortSignal } }): Promise<AsyncIterable<{
      name?: string
      displayName?: string
      supportedActions?: string[]
    }>>
  }
}

export type GeminiClientFactory = (apiKey: string) => GeminiClientLike

const defaultFactory: GeminiClientFactory = (apiKey) => new GoogleGenAI({ apiKey }) as unknown as GeminiClientLike

export class GeminiProvider extends ApiKeyProvider {
  readonly id = 'gemini' as const
  readonly name = 'Gemini'
  private readonly createClient: GeminiClientFactory

  constructor(deps: ApiKeyProviderDeps & { createClient?: GeminiClientFactory }) {
    super(deps)
    this.createClient = deps.createClient ?? defaultFactory
  }

  protected integrationNote(): string | undefined {
    return this.deps.integrationEnabled ? undefined : 'Интеграция Gemini отключена в этой сборке.'
  }

  protected async listModels(apiKey: string, signal: AbortSignal): Promise<ModelInfo[]> {
    try {
      const pager = await this.createClient(apiKey).models.list({ config: { pageSize: 100, abortSignal: signal } })
      const models: ModelInfo[] = []
      for await (const model of pager) {
        if (!model?.name) continue
        const info = geminiModelFromListing(model.name, model.displayName, model.supportedActions)
        if (info) models.push(info)
        if (models.length >= 200) break
      }
      return models
    } catch (err) {
      throw this.toError(err)
    }
  }

  protected autoModel(models: ModelInfo[] | null, vision: boolean): string {
    return pickModel(models, GEMINI_DEFAULT_MODEL, vision)
  }

  protected modelVision(modelId: string): boolean | undefined {
    return geminiModelFromListing(modelId)?.vision
  }

  protected async performRequest(
    apiKey: string,
    model: string,
    request: VisionRequest | TextRequest,
    signal: AbortSignal
  ): Promise<ProviderResult> {
    const parts: unknown[] = [{ text: request.prompt }]
    if (isVisionRequest(request)) {
      parts.push({ inlineData: { mimeType: request.mimeType, data: request.image.toString('base64') } })
    }
    try {
      const response = await this.createClient(apiKey).models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: {
          ...(request.json ? { responseMimeType: 'application/json' } : {}),
          ...(request.instructions ? { systemInstruction: request.instructions } : {}),
          abortSignal: signal
        }
      })
      const meta = response.usageMetadata
      return {
        text: (response.text ?? '').trim(),
        model,
        usage: {
          inputTokens: meta?.promptTokenCount,
          outputTokens: meta?.candidatesTokenCount,
          totalTokens: meta?.totalTokenCount
        }
        // The Gemini API sends no rate-limit headers; remaining quota is not exposed.
      }
    } catch (err) {
      if (signal.aborted) throw err
      throw this.toError(err)
    }
  }

  /** Maps @google/genai ApiError (status + JSON body in message) to ProviderError. */
  private toError(err: unknown): ProviderError {
    if (err instanceof ProviderError) return err
    const status = typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : undefined
    const message = String((err as { message?: unknown })?.message ?? '')
    if (status === undefined) return normalizeThrown(this.id, err)

    if (status === 429) {
      const quota = parseGeminiQuotaError(message)
      if (quota?.perDay) {
        // Daily quota exhausted. retryDelay is provider-reported; otherwise the documented reset is
        // midnight Pacific time, which is shown as an estimate.
        return new ProviderError(this.id, 'PLAN_LIMIT', {
          status,
          message: 'Суточный лимит Gemini исчерпан.',
          ...(quota.retryDelaySeconds !== undefined
            ? { retryAfter: quota.retryDelaySeconds }
            : { resetAt: nextPacificMidnight(this.now()), resetIsEstimate: true }),
          originalError: err
        })
      }
      return new ProviderError(this.id, 'RATE_LIMIT', {
        status,
        ...(quota?.retryDelaySeconds !== undefined ? { retryAfter: quota.retryDelaySeconds } : {}),
        originalError: err
      })
    }
    if (status === 400 && /API_KEY_INVALID/.test(message)) return new ProviderError(this.id, 'AUTH', { status, originalError: err })
    return new ProviderError(this.id, codeFromHttpStatus(status), { status, originalError: err })
  }
}
