import { PROVIDER_NAMES, type AiSettings, type OperationType, type ProviderId, type RoutingNotice } from '../../shared/providers'
import { looksLikeJsonAttempt, extractBlockItems } from '../../shared/structuredJson'
import { AllProvidersFailedError } from './router'
import type { ProviderManager } from './manager'
import type { LocalOcrResult, TesseractProvider } from './impl/tesseract'

export interface RecognitionPrompts {
  /** Prompt sent with the screenshot to a vision model. */
  vision: string
  /** Prompt that structures locally recognized text (economy / balanced-simple). */
  textFormat: (localText: string) => string
  /** One-shot "re-emit as valid JSON" prompt. */
  jsonRepair: (broken: string) => string
}

export interface RecognitionOutput {
  /** JSON block list text when structured, plain text otherwise. */
  raw: string
  structured: boolean
  provider: ProviderId
  providerName: string
  model: string
  notice: RoutingNotice | null
  /** Result came from local OCR although cloud recognition was allowed (cloud failed / unavailable). */
  offlineFallback: boolean
  mode: AiSettings['mode']
  /** Line layout from Tesseract when the result is local (lets callers rebuild structure offline). */
  localLines?: LocalOcrResult['lines']
}

export interface ComplexityAssessment {
  complex: boolean
  reasons: ('empty' | 'low_confidence' | 'uncertain_words' | 'columns' | 'code' | 'ui')[]
  operation: OperationType
}

const MIN_CONFIDENCE = 75
const LOW_WORD_CONFIDENCE = 60
const MAX_UNCERTAIN_RATIO = 0.15
const CODE_LINE = /[{};]|=>|==|!=|<\/?[a-z]+>|^\s*(def|function|const|let|var|import|from|class|return|if|for|while|public|private|#include|SELECT|FROM)\b/i

/**
 * Balanced mode: decides from the local OCR result whether a vision model is needed.
 * Simple, confidently recognized prose stays on the cheap text path.
 */
export function assessComplexity(local: LocalOcrResult): ComplexityAssessment {
  const reasons: ComplexityAssessment['reasons'] = []
  const lines = local.lines.filter((l) => l.text.trim())
  if (!local.text.trim() || lines.length === 0) reasons.push('empty')
  if (local.confidence < MIN_CONFIDENCE) reasons.push('low_confidence')

  const words = lines.flatMap((l) => l.wordConfidences)
  if (words.length > 0 && words.filter((c) => c < LOW_WORD_CONFIDENCE).length / words.length > MAX_UNCERTAIN_RATIO) {
    reasons.push('uncertain_words')
  }

  // Lines that share a vertical band sit side by side: columns or a table.
  let sideBySide = 0
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i].bbox
      const b = lines[j].bbox
      const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
      const height = Math.min(a.y1 - a.y0, b.y1 - b.y0)
      const horizontallyApart = a.x1 < b.x0 || b.x1 < a.x0
      if (height > 0 && overlap > height * 0.5 && horizontallyApart) sideBySide++
    }
  }
  if (sideBySide >= 2) reasons.push('columns')

  const codeLines = lines.filter((l) => CODE_LINE.test(l.text)).length
  if (lines.length >= 2 && codeLines / lines.length >= 0.3) reasons.push('code')

  const avgLength = lines.reduce((sum, l) => sum + l.text.trim().length, 0) / Math.max(1, lines.length)
  if (lines.length >= 6 && avgLength < 14) reasons.push('ui')

  const operation: OperationType = reasons.includes('code')
    ? 'CODE_RECOGNITION'
    : reasons.includes('columns')
      ? 'TABLE_RECOGNITION'
      : 'OCR_VISION'
  return { complex: reasons.length > 0, reasons, operation }
}

/**
 * Screenshot → text/structure according to the AI usage mode:
 * - best:     vision model gets the screenshot; Tesseract last.
 * - balanced: Tesseract first; complex layouts go to a vision model, simple text to a text model.
 * - economy:  Tesseract → text model structures the text (no image leaves the computer).
 * - offline:  Tesseract only; nothing is sent anywhere.
 */
export class RecognitionService {
  constructor(
    /** Exposed for callers that need other AI tasks (e.g. note titles) through the same routing. */
    readonly manager: ProviderManager,
    private readonly tesseract: TesseractProvider,
    private readonly getSettings: () => AiSettings
  ) {}

  async recognize(png: Buffer, prompts: RecognitionPrompts): Promise<RecognitionOutput> {
    const mode = this.getSettings().mode
    if (mode === 'offline') return this.localOnly(png, mode)

    if (mode === 'best') return this.visionPath(png, prompts, mode, 'OCR_VISION', null)

    // Assigned inside a closure; the cast keeps TypeScript from narrowing it to null.
    let local = null as LocalOcrResult | null
    try {
      // Through the manager so the local pass is logged as activity like any other request.
      await this.manager.execute({
        operation: 'OCR_VISION',
        requiredCapabilities: ['vision'],
        imageSent: false,
        includeLocalFallback: true,
        onlyProvider: 'tesseract',
        run: async () => {
          local = await this.tesseract.recognizeDetailed(png)
          return { text: local.text, model: 'tesseract' }
        }
      })
    } catch {
      local = null
    }
    if (!local) return this.visionPath(png, prompts, mode, 'OCR_VISION', null)

    if (mode === 'economy') return this.textPath(local, prompts, mode)

    const assessment = assessComplexity(local)
    if (assessment.reasons.includes('empty')) {
      return this.visionPath(png, prompts, mode, assessment.operation, local)
    }
    return assessment.complex
      ? this.visionPath(png, prompts, mode, assessment.operation, local)
      : this.textPath(local, prompts, mode)
  }

  private async localOnly(png: Buffer, mode: AiSettings['mode']): Promise<RecognitionOutput> {
    let local = null as LocalOcrResult | null
    const outcome = await this.manager.execute({
      operation: 'OCR_VISION',
      requiredCapabilities: ['vision'],
      imageSent: false,
      includeLocalFallback: true,
      onlyProvider: 'tesseract',
      run: async () => {
        local = await this.tesseract.recognizeDetailed(png)
        return { text: local.text, model: 'tesseract' }
      }
    })
    return { ...this.output(outcome.result.text, false, 'tesseract', outcome.result.model, null, false, mode), localLines: local?.lines }
  }

  private async visionPath(
    png: Buffer,
    prompts: RecognitionPrompts,
    mode: AiSettings['mode'],
    operation: OperationType,
    localResult: LocalOcrResult | null
  ): Promise<RecognitionOutput> {
    let fallbackLocal = null as LocalOcrResult | null
    try {
      const outcome = await this.manager.execute({
        operation,
        requiredCapabilities: ['vision'],
        imageSent: true,
        // Tesseract is the last fallback; skip re-running it when its result is already in hand.
        includeLocalFallback: localResult === null,
        run: async (provider) => {
          if (provider.local) {
            fallbackLocal = await this.tesseract.recognizeDetailed(png)
            return { text: fallbackLocal.text, model: 'tesseract' }
          }
          return provider.runStructuredOutput({ operation, prompt: prompts.vision, image: png, mimeType: 'image/png' })
        }
      })
      const usedProvider = this.manager.get(outcome.provider)
      if (usedProvider?.local) {
        return {
          ...this.output(outcome.result.text, false, outcome.provider, outcome.result.model, outcome.notice, true, mode),
          localLines: fallbackLocal?.lines
        }
      }
      const raw = await this.ensureJson(outcome.provider, outcome.result.text, prompts.jsonRepair)
      return this.output(raw, extractBlockItems(raw) !== null, outcome.provider, outcome.result.model, outcome.notice, false, mode)
    } catch (err) {
      if (err instanceof AllProvidersFailedError && localResult) {
        return { ...this.output(localResult.text, false, 'tesseract', 'tesseract', this.failureNotice(err), true, mode), localLines: localResult.lines }
      }
      throw err
    }
  }

  private async textPath(local: LocalOcrResult, prompts: RecognitionPrompts, mode: AiSettings['mode']): Promise<RecognitionOutput> {
    if (!local.text.trim()) return { ...this.output('', false, 'tesseract', 'tesseract', null, false, mode), localLines: local.lines }
    try {
      const outcome = await this.manager.execute({
        operation: 'OCR_CLEANUP',
        requiredCapabilities: ['text', 'ocrCleanup'],
        imageSent: false,
        includeLocalFallback: false,
        run: (provider) => provider.runStructuredOutput({ operation: 'OCR_CLEANUP', prompt: prompts.textFormat(local.text) })
      })
      const raw = await this.ensureJson(outcome.provider, outcome.result.text, prompts.jsonRepair)
      return this.output(raw, extractBlockItems(raw) !== null, outcome.provider, outcome.result.model, outcome.notice, false, mode)
    } catch (err) {
      if (err instanceof AllProvidersFailedError) {
        // No text model reachable: the local text is still a result.
        return {
          ...this.output(local.text, false, 'tesseract', 'tesseract', this.failureNotice(err), err.attempts.length > 0, mode),
          localLines: local.lines
        }
      }
      throw err
    }
  }

  /**
   * Validates JSON; on failure makes exactly one text-only repair request to the same provider.
   * If that fails too, the original text is returned and the caller falls back to plain text.
   */
  private async ensureJson(provider: ProviderId, raw: string, jsonRepair: (broken: string) => string): Promise<string> {
    if (extractBlockItems(raw) !== null) return raw
    if (!raw.trim() || !looksLikeJsonAttempt(raw)) return raw
    try {
      const repaired = await this.manager.execute({
        operation: 'OCR_CLEANUP',
        requiredCapabilities: ['text'],
        imageSent: false,
        includeLocalFallback: false,
        onlyProvider: provider,
        run: (p) => p.runStructuredOutput({ operation: 'OCR_CLEANUP', prompt: jsonRepair(raw) })
      })
      return extractBlockItems(repaired.result.text) !== null ? repaired.result.text : raw
    } catch {
      return raw
    }
  }

  private failureNotice(err: AllProvidersFailedError): RoutingNotice | null {
    if (err.attempts.length === 0) return null
    return {
      usedProvider: 'tesseract',
      usedProviderName: PROVIDER_NAMES.tesseract,
      skipped: err.attempts.map((a) => ({ provider: a.provider, name: PROVIDER_NAMES[a.provider], code: a.error.code })),
      offlineFallback: true
    }
  }

  private output(
    raw: string,
    structured: boolean,
    provider: ProviderId,
    model: string,
    notice: RoutingNotice | null,
    offlineFallback: boolean,
    mode: AiSettings['mode']
  ): RecognitionOutput {
    return { raw, structured, provider, providerName: PROVIDER_NAMES[provider], model, notice, offlineFallback, mode }
  }
}
