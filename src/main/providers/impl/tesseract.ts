import type { ModelInfo, ProviderCapabilities, ProviderConnectionInfo, ProviderUsage, UsageWindow } from '../../../shared/providers'
import { ProviderError, normalizeThrown } from '../errors'
import type { AIProvider, HealthCheckResult, IntegrationInfo, ProviderResult, TextRequest, VisionRequest } from '../types'

export interface LocalOcrLine {
  text: string
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
  wordConfidences: number[]
  /** Words with their own confidence, for "uncertain" marks. */
  words?: { text: string; confidence: number; bbox?: { x0: number; y0: number; x1: number; y1: number } }[]
}

export interface LocalOcrResult {
  text: string
  /** Mean confidence 0–100 reported by Tesseract. */
  confidence: number
  lines: LocalOcrLine[]
}

/** The local engine (tesseract.js in production, a fake in tests). */
export interface LocalOcrEngine {
  recognize(png: Buffer): Promise<LocalOcrResult>
  ready(): Promise<void>
}

const CAPABILITIES: ProviderCapabilities = {
  vision: true,
  ocr: true,
  text: false,
  structuredOutput: false,
  ocrCleanup: false,
  tables: false,
  codeRecognition: false,
  translation: false,
  noteActions: false,
  embeddings: false
}

/** Offline OCR. Always available, no limits, and always the last fallback. Nothing leaves the computer. */
export class TesseractProvider implements AIProvider {
  readonly id = 'tesseract' as const
  readonly name = 'Tesseract'
  readonly kind = 'local' as const
  readonly authType = 'none' as const
  readonly local = true

  constructor(
    private readonly engine: LocalOcrEngine,
    private readonly integrationEnabled = true
  ) {}

  getIntegration(): IntegrationInfo {
    return { enabled: this.integrationEnabled }
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async refreshAuthentication(): Promise<void> {}

  async isAvailable(): Promise<boolean> {
    return this.integrationEnabled
  }

  async getConnectionInfo(): Promise<ProviderConnectionInfo> {
    return { connected: this.integrationEnabled }
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    return [{ id: 'rus+eng', displayName: 'Русский + English', vision: true }]
  }

  getCapabilities(): ProviderCapabilities {
    return CAPABILITIES
  }

  async canServeVision(): Promise<boolean> {
    return true
  }

  /** Full local result with confidences, for Balanced mode's complexity check. */
  async recognizeDetailed(png: Buffer): Promise<LocalOcrResult> {
    try {
      return await this.engine.recognize(png)
    } catch (err) {
      throw new ProviderError(this.id, 'UNKNOWN', { message: 'Локальное распознавание не удалось.', originalError: err })
    }
  }

  async runVision(request: VisionRequest): Promise<ProviderResult> {
    const result = await this.recognizeDetailed(request.image)
    return { text: result.text, model: 'tesseract' }
  }

  async runText(_request: TextRequest): Promise<ProviderResult> {
    throw new ProviderError(this.id, 'UNSUPPORTED', { message: 'Tesseract распознаёт только изображения.' })
  }

  async runStructuredOutput(_request: VisionRequest | TextRequest): Promise<ProviderResult> {
    throw new ProviderError(this.id, 'UNSUPPORTED', { message: 'Tesseract не возвращает структурированный ответ.' })
  }

  async getUsage(): Promise<Partial<ProviderUsage>> {
    return { source: 'Локально', accuracy: 'exact', windows: [], note: 'Без ограничений · офлайн' }
  }

  getRateLimits(): UsageWindow[] {
    return []
  }

  cancelRequest(): void {
    /* tesseract.js jobs are short; there is nothing to abort safely */
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      await this.engine.ready()
      return { ok: true, message: 'Локальное распознавание готово' }
    } catch (err) {
      return { ok: false, message: normalizeThrown(this.id, err).message }
    }
  }
}
