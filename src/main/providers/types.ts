import type {
  AuthenticationType,
  ModelInfo,
  OperationType,
  ProviderCapabilities,
  ProviderConnectionInfo,
  ProviderErrorCode,
  ProviderId,
  ProviderKind,
  ProviderUsage,
  UsageWindow
} from '../../shared/providers'

export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

interface RequestBase {
  operation: OperationType
  /** Ask the provider for a single JSON object (native JSON mode where the provider has one). */
  json?: boolean
  /** System-level guidance. Providers without a system role prepend it to the prompt. */
  instructions?: string
  signal?: AbortSignal
}

export interface VisionRequest extends RequestBase {
  prompt: string
  image: Buffer
  mimeType: 'image/png'
}

export interface TextRequest extends RequestBase {
  prompt: string
}

export interface ProviderResult {
  text: string
  model: string
  usage?: TokenUsage
  /** Rate-limit/usage windows the provider reported with this response (headers, etc.). */
  rateLimits?: UsageWindow[]
  /** Short description of where rateLimits came from, e.g. "x-ratelimit-* (ключ Gemini #2)". */
  rateLimitSource?: string
  /**
   * 'markdown' = the text is an OCR engine's Markdown (not the JSON block schema). The recognition
   * service converts it to note blocks locally, so no second AI request is needed.
   */
  format?: 'markdown'
}

export interface HealthCheckResult {
  ok: boolean
  message: string
  /** Normalized failure, so the status can reflect e.g. a rejected key. */
  errorCode?: ProviderErrorCode
}

export interface IntegrationInfo {
  /** Feature flag for this integration (see featureFlags.ts). */
  enabled: boolean
  /** Why it is disabled or restricted, in user-facing Russian. */
  note?: string
}

/**
 * One AI source. Implementations translate SDK/HTTP specifics into this interface and throw only
 * ProviderError. Nothing outside src/main/providers/impl may depend on a concrete SDK.
 */
export interface AIProvider {
  readonly id: ProviderId
  readonly name: string
  readonly kind: ProviderKind
  readonly authType: AuthenticationType
  /** true = nothing leaves this computer. */
  readonly local: boolean

  getIntegration(): IntegrationInfo
  /** Interactive connection (OAuth). API-key providers connect through setApiKey on the manager. */
  connect(options?: { reconsent?: boolean }): Promise<void>
  disconnect(): Promise<void>
  refreshAuthentication(): Promise<void>
  /** Configured and authorized. Says nothing about rate limits (UsageService tracks those). */
  isAvailable(): Promise<boolean>
  getConnectionInfo(): Promise<ProviderConnectionInfo>
  /** refresh = re-fetch from the provider; cachedOnly = never touch the network (UI state). */
  getAvailableModels(options?: { refresh?: boolean; cachedOnly?: boolean }): Promise<ModelInfo[]>
  getCapabilities(): ProviderCapabilities
  /**
   * Whether a vision request could be served with the current model selection (false = skip).
   * `imageBytes` lets providers with an inline-image size limit decline screenshots that do not fit.
   */
  canServeVision(imageBytes?: number): Promise<boolean>
  runVision(request: VisionRequest): Promise<ProviderResult>
  runText(request: TextRequest): Promise<ProviderResult>
  runStructuredOutput(request: VisionRequest | TextRequest): Promise<ProviderResult>
  /**
   * Provider-specific usage snapshot, independent of Snap Notes' own activity counting. Return null
   * when the provider exposes nothing (the UsageService then shows "unknown", never a guess).
   */
  getUsage(): Promise<Partial<ProviderUsage> | null>
  getRateLimits(): UsageWindow[]
  cancelRequest(): void
  healthCheck(): Promise<HealthCheckResult>
}

/** Model choice for a provider: 'auto' or an id from getAvailableModels(). */
export type ModelSelector = () => string

export function isVisionRequest(request: VisionRequest | TextRequest): request is VisionRequest {
  return (request as VisionRequest).image !== undefined
}
