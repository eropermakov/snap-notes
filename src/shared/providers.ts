/**
 * Provider model shared by the main process and the renderer.
 *
 * Everything in this file is safe to send over IPC: no type here may ever carry an API key,
 * an OAuth access/refresh/ID token or any other secret. Secrets live only in the main process
 * (see src/main/providers/secretStore.ts).
 */

export type ProviderId =
  | 'chatgpt'
  | 'claude'
  | 'gemini'
  | 'groq'
  | 'openai'
  | 'anthropic'
  | 'openrouter'
  | 'mistral'
  | 'cerebras'
  | 'cloudflare'
  | 'nvidia'
  | 'cohere'
  | 'huggingface'
  | 'modal'
  | 'tesseract'

export const PROVIDER_IDS: ProviderId[] = [
  'chatgpt',
  'claude',
  'gemini',
  'groq',
  'openai',
  'anthropic',
  'openrouter',
  'mistral',
  'cerebras',
  'cloudflare',
  'nvidia',
  'cohere',
  'huggingface',
  'modal',
  'tesseract'
]

/** Providers whose credential is an API key (or token) the user pastes into Settings. */
export type ApiKeyProviderId =
  | 'gemini'
  | 'groq'
  | 'openai'
  | 'anthropic'
  | 'openrouter'
  | 'mistral'
  | 'cerebras'
  | 'cloudflare'
  | 'nvidia'
  | 'cohere'
  | 'huggingface'
  | 'modal'
export const API_KEY_PROVIDERS: ApiKeyProviderId[] = [
  'gemini',
  'groq',
  'openai',
  'anthropic',
  'openrouter',
  'mistral',
  'cerebras',
  'cloudflare',
  'nvidia',
  'cohere',
  'huggingface',
  'modal'
]

export type ProviderKind = 'subscription' | 'api' | 'local'
export type AuthenticationType = 'oauth' | 'api_key' | 'none'

export interface ProviderCapabilities {
  vision: boolean
  /**
   * A dedicated OCR engine (e.g. Mistral OCR, a Modal OCR endpoint): takes an image and returns
   * Markdown/text, ignores JSON-schema prompts. Its output is converted to note blocks locally.
   */
  ocr: boolean
  text: boolean
  structuredOutput: boolean
  ocrCleanup: boolean
  tables: boolean
  codeRecognition: boolean
  translation: boolean
  noteActions: boolean
  embeddings: boolean
}

export type Capability = keyof ProviderCapabilities

export type ProviderStatus =
  | 'AVAILABLE'
  | 'LIMIT_LOW'
  | 'LIMIT_REACHED'
  | 'RATE_LIMITED'
  | 'AUTH_REQUIRED'
  | 'AUTH_EXPIRED'
  | 'UNAVAILABLE'
  | 'OFFLINE'
  | 'ERROR'
  | 'UNKNOWN'

/**
 * How trustworthy a usage number is.
 * - exact / provider_reported: the provider sent it (headers, API field). Safe to show as a number.
 * - estimated: derived by Snap Notes (always shown with "~" and a tooltip).
 * - unknown: nothing reliable is known. Never show a number.
 */
export type UsageAccuracy = 'exact' | 'provider_reported' | 'estimated' | 'unknown'
export type UsageMeasurement = 'tokens' | 'requests' | 'credits' | 'percentage' | 'messages' | 'unknown'

export interface UsageWindow {
  id: string
  label: string
  limit?: number
  used?: number
  remaining?: number
  usedPercent?: number
  remainingPercent?: number
  /** Absolute UTC timestamp (ms). Renderers count down to it locally. */
  resetAt?: number
  /** Seconds until reset at the time `updatedAt` was recorded. */
  resetInSeconds?: number
  measurement: UsageMeasurement
  accuracy: UsageAccuracy
}

export interface ProviderUsage {
  providerId: ProviderId
  /** Where the numbers came from, e.g. "x-ratelimit-* headers" or "ChatGPT plan (managed by ChatGPT)". */
  source: string
  accuracy: UsageAccuracy
  windows: UsageWindow[]
  credits?: { balance?: number; currency?: string; accuracy: UsageAccuracy }
  /** UTC ms. */
  updatedAt: number
  status: ProviderStatus
  /** Earliest known reset of a blocking limit (UTC ms), only when the provider reported it. */
  resetAt?: number
  /** Accuracy of `resetAt` (a documented-policy reset is 'estimated'). */
  resetAccuracy?: UsageAccuracy
  /** Short human text for the card, e.g. "Использование управляется ChatGPT". */
  note?: string
  /** Official page where the user can see/manage usage. Opened in the system browser. */
  manageUrl?: string
  stale?: boolean
  /**
   * A documented free allocation without a remaining counter (e.g. Cloudflare "10 000 Neurons/day").
   * Shown as a fact; never as a percentage. resetAt follows the documented rule ('estimated').
   */
  allocation?: { label: string; resetAt?: number; resetRule?: string }
}

/** Snap Notes' own count of today's requests for one provider. Not the provider's remaining quota. */
export interface LocalUsage {
  requests: number
  failures: number
  tokens: number
}

export type ProviderErrorCode =
  | 'AUTH'
  | 'AUTH_EXPIRED'
  | 'NO_PERMISSION'
  | 'RATE_LIMIT'
  | 'PLAN_LIMIT'
  | 'INSUFFICIENT_CREDITS'
  | 'MODEL_UNAVAILABLE'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'PROVIDER_DOWN'
  | 'CANCELLED'
  | 'UNSUPPORTED'
  | 'UNKNOWN'

/** Normalized error, safe for the renderer (no original error object). */
export interface ProviderErrorInfo {
  provider: ProviderId
  code: ProviderErrorCode
  message: string
  retryAfter?: number
  resetAt?: number
  canFallback: boolean
  at: number
}

export interface ModelInfo {
  id: string
  displayName: string
  /** true/false only when known (catalog field or documented model family); undefined = unknown. */
  vision?: boolean
  /** true = costs nothing to call (provider-reported pricing), false = paid, undefined = unknown. */
  free?: boolean
  /** Context window in tokens, when the catalog reports it. Used to rank Automatic choices. */
  contextLength?: number
  /** The catalog says the model supports structured/JSON output. */
  structured?: boolean
}

/** One non-key credential field of a provider (Cloudflare account ID, Modal endpoint, …). */
export interface ProviderFieldState {
  id: string
  set: boolean
  /** Only for non-secret fields (account ID, endpoint URL); secrets never leave the main process. */
  value?: string
}

export interface ProviderKeyInfo {
  id: string
  label: string
  /** true when the key is stored in OS-encrypted storage (Windows DPAPI via Electron safeStorage). */
  secure: boolean
}

export interface ProviderConnectionInfo {
  connected: boolean
  accountName?: string
  accountEmail?: string
  /** ChatGPT only: the user granted permission to use their ChatGPT plan. */
  planUsageEnabled?: boolean
  /** ChatGPT only: sign-in in progress (browser open). */
  connecting?: boolean
  keys?: ProviderKeyInfo[]
  /** Extra credential fields besides the key (see providerCatalog.ts). */
  fields?: ProviderFieldState[]
}

/** Everything the UI needs about one provider. Never contains credentials. */
export interface ProviderPublicState {
  id: ProviderId
  name: string
  kind: ProviderKind
  authType: AuthenticationType
  /** Processing happens on this computer; nothing leaves it. */
  local: boolean
  /** Feature flag for this integration. Disabled integrations are shown but never used. */
  integrationEnabled: boolean
  /** Explanation when the integration is intentionally unavailable (policy, approval, flag). */
  integrationNote?: string
  configured: boolean
  connection: ProviderConnectionInfo
  capabilities: ProviderCapabilities
  status: ProviderStatus
  usage: ProviderUsage
  models: ModelInfo[]
  selectedModel: string
  lastError?: ProviderErrorInfo
  /** Snap Notes' local counter for today ("Local usage"), when it has sent any requests. */
  localUsage?: LocalUsage
}

export type AiUsageMode = 'best' | 'balanced' | 'economy' | 'offline'

/** What Automatic optimizes for. 'custom' = the user's own provider order. */
export type AiPreference = 'free' | 'quality' | 'speed' | 'custom'
export const AI_PREFERENCES: AiPreference[] = ['free', 'quality', 'speed', 'custom']

export interface AiSettings {
  mode: AiUsageMode
  prefer: AiPreference
  /** Priority for cloud providers. Tesseract is never listed: it is always the last fallback. */
  priority: ProviderId[]
  autoFallback: boolean
  protectLowLimits: boolean
  /** Force one provider for every request; null = Automatic. */
  preferredProvider: ProviderId | null
  /** 'auto' or a model id reported by the provider. */
  models: Partial<Record<ProviderId, string>>
  /** Logs request/response content snippets. Off by default. */
  debugContentLogging: boolean
  /** Shown once after the first ChatGPT sign-in with plan usage enabled. */
  chatgptWelcomeSeen: boolean
}

export const DEFAULT_PRIORITY: ProviderId[] = [
  'chatgpt',
  'claude',
  'gemini',
  'groq',
  'openrouter',
  'mistral',
  'cerebras',
  'cloudflare',
  'nvidia',
  'cohere',
  'huggingface',
  'modal',
  'openai',
  'anthropic'
]

export const DEFAULT_AI_SETTINGS: AiSettings = {
  mode: 'balanced',
  prefer: 'free',
  priority: DEFAULT_PRIORITY,
  autoFallback: true,
  protectLowLimits: true,
  preferredProvider: null,
  models: {},
  debugContentLogging: false,
  chatgptWelcomeSeen: false
}

export type OperationType =
  | 'OCR_VISION'
  | 'OCR_CLEANUP'
  | 'TABLE_RECOGNITION'
  | 'CODE_RECOGNITION'
  | 'AI_REWRITE'
  | 'AI_SUMMARY'
  | 'TRANSLATION'
  | 'TITLE_GENERATION'

/** One row of Snap Notes' own LOCAL ACTIVITY log. Not provider usage. */
export interface ActivityRecord {
  provider: ProviderId
  model: string
  timestamp: number
  operationType: OperationType
  durationMs: number
  success: boolean
  errorCode?: ProviderErrorCode
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  imageSent: boolean
  fallbackUsed: boolean
}

export interface ActivitySummary {
  /** Local date (YYYY-MM-DD) the summary covers. */
  day: string
  byProvider: Partial<Record<ProviderId, { requests: number; failures: number; totalTokens: number }>>
}

/** Result notice shown after a request that needed a fallback. */
export interface RoutingNotice {
  usedProvider: ProviderId
  usedProviderName: string
  skipped: { provider: ProviderId; name: string; code: ProviderErrorCode; resetAt?: number }[]
  offlineFallback: boolean
}

/** A status is "blocking" when the router must not send requests to the provider right now. */
export function isBlockingStatus(status: ProviderStatus): boolean {
  return (
    status === 'LIMIT_REACHED' ||
    status === 'RATE_LIMITED' ||
    status === 'AUTH_REQUIRED' ||
    status === 'AUTH_EXPIRED' ||
    status === 'UNAVAILABLE' ||
    status === 'OFFLINE'
  )
}

/** LIMIT_LOW threshold: only applied to provider-reported remaining percentages. */
export const LIMIT_LOW_REMAINING_PERCENT = 20

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
  groq: 'Groq',
  openai: 'OpenAI API',
  anthropic: 'Anthropic API',
  openrouter: 'OpenRouter',
  mistral: 'Mistral',
  cerebras: 'Cerebras',
  cloudflare: 'Cloudflare Workers AI',
  nvidia: 'NVIDIA NIM',
  cohere: 'Cohere',
  huggingface: 'Hugging Face',
  modal: 'Modal OCR',
  tesseract: 'Tesseract'
}
