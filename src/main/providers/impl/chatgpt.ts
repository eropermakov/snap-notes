import type {
  ModelInfo,
  ProviderCapabilities,
  ProviderConnectionInfo,
  ProviderErrorCode,
  ProviderUsage,
  UsageWindow
} from '../../../shared/providers'
import { ProviderError } from '../errors'
import type { AIProvider, HealthCheckResult, IntegrationInfo, ProviderResult, TextRequest, VisionRequest } from '../types'
import { isVisionRequest } from '../types'
import type {
  ChatGPTClient,
  ResponseContentPart,
  SessionState
} from '../../vendor/siwc-local/index'

/** Official ChatGPT Settings → Usage page (also exported by the SDK as CHATGPT_USAGE_URL). */
export const CHATGPT_MANAGE_USAGE_URL = 'https://chatgpt.com/settings/usage'

const CAPABILITIES: ProviderCapabilities = {
  vision: true,
  ocr: false,
  text: true,
  structuredOutput: true,
  ocrCleanup: true,
  tables: true,
  codeRecognition: true,
  translation: true,
  noteActions: true,
  embeddings: false
}

/** Codes from the SDK / SIWC "Errors and recovery" docs → normalized codes. */
const CODE_MAP: Record<string, ProviderErrorCode> = {
  subscription_sharing_usage_limit_exceeded: 'PLAN_LIMIT',
  subscription_sharing_usage_unavailable: 'PROVIDER_DOWN',
  subscription_sharing_user_unavailable: 'PROVIDER_DOWN',
  subscription_sharing_user_not_eligible: 'NO_PERMISSION',
  subscription_sharing_route_not_supported: 'UNSUPPORTED',
  subscription_sharing_unsupported_capability: 'UNSUPPORTED',
  subscription_sharing_invalid_user: 'AUTH',
  subscription_sharing_v2_client_not_enabled: 'NO_PERMISSION',
  chatpass_v2_scope_not_authorized: 'NO_PERMISSION',
  chatpass_v2_invalid_authorization_context: 'NO_PERMISSION',
  sharing_not_enabled: 'NO_PERMISSION',
  sign_in_required: 'AUTH',
  invalid_grant: 'AUTH_EXPIRED',
  invalid_refresh_token: 'AUTH_EXPIRED',
  token_expired: 'AUTH_EXPIRED',
  refresh_token_expired: 'AUTH_EXPIRED',
  refresh_token_invalidated: 'AUTH_EXPIRED',
  refresh_token_reused: 'AUTH_EXPIRED',
  invalid_id_token: 'AUTH_EXPIRED',
  account_mismatch: 'AUTH_EXPIRED',
  refresh_not_ready: 'PROVIDER_DOWN',
  identity_verification_unavailable: 'PROVIDER_DOWN',
  invalid_token: 'AUTH',
  model_not_found: 'MODEL_UNAVAILABLE',
  network_error: 'NETWORK',
  connection_error: 'NETWORK',
  cancelled: 'CANCELLED',
  response_incomplete: 'INVALID_RESPONSE',
  stream_interrupted: 'NETWORK',
  invalid_stream: 'INVALID_RESPONSE',
  invalid_response: 'INVALID_RESPONSE',
  connection_busy: 'PROVIDER_DOWN',
  storage_busy: 'PROVIDER_DOWN',
  storage_encryption_unavailable: 'AUTH',
  storage_decryption_failed: 'AUTH'
}

const MESSAGES: Partial<Record<string, string>> = {
  subscription_sharing_usage_limit_exceeded: 'Лимит ChatGPT исчерпан (план или лимит для Snap Notes). Проверьте «Управление использованием».',
  subscription_sharing_user_not_eligible: 'Использование плана ChatGPT недоступно для этого аккаунта или рабочего пространства.',
  sharing_not_enabled: 'Вы вошли в ChatGPT, но не разрешили использовать план. Включите это в настройках Snap Notes.',
  sign_in_required: 'Войдите в ChatGPT.'
}

interface ChatGptErrorLike {
  code?: unknown
  status?: unknown
  retryAfterSeconds?: unknown
  param?: unknown
}

export function mapChatGptError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err
  const e = (err ?? {}) as ChatGptErrorLike
  const sdkCode = typeof e.code === 'string' ? e.code : ''
  const status = typeof e.status === 'number' ? e.status : undefined
  let code: ProviderErrorCode = CODE_MAP[sdkCode] ?? 'UNKNOWN'
  if (code === 'UNKNOWN' && status !== undefined) {
    if (status === 401) code = 'AUTH'
    else if (status === 403) code = 'NO_PERMISSION'
    else if (status === 429) code = 'RATE_LIMIT'
    else if (status >= 500) code = 'PROVIDER_DOWN'
  }
  const retryAfter = typeof e.retryAfterSeconds === 'number' ? e.retryAfterSeconds : undefined
  // The docs say not to infer a reset time from subscription_sharing_usage_limit_exceeded: only an
  // explicit retry-after header is used, never a guess.
  return new ProviderError('chatgpt', code, {
    ...(MESSAGES[sdkCode] ? { message: MESSAGES[sdkCode] } : {}),
    ...(retryAfter !== undefined ? { retryAfter } : {}),
    ...(status !== undefined ? { status } : {}),
    originalError: err
  })
}

/** Session errors that describe local storage contention, not an expired sign-in. */
const TRANSIENT_SESSION_ERRORS = new Set(['storage_busy', 'storage_lock_lost', 'connection_busy', 'identity_verification_unavailable'])

/** reauth_required caused only by transient local contention is not an expired sign-in. */
export function sessionNeedsReauth(session: SessionState): boolean {
  return session.status === 'reauth_required' && !TRANSIENT_SESSION_ERRORS.has(session.error?.code ?? '')
}

function sessionKey(session: SessionState): string {
  return JSON.stringify([session.status, session.sharing, session.profileId, session.identity, session.error?.code])
}

/** Coalesces bursts of getSession() calls (each one takes the SDK's interprocess file lock). */
const SESSION_CACHE_MS = 1500

export interface ChatGptProviderDeps {
  /** Lazily creates the SDK client (needs Electron safeStorage, so it is built after app ready). */
  getClient: () => ChatGPTClient | null
  getModel: () => string
  integrationEnabled: boolean
  integrationNote?: string
}

/**
 * ChatGPT plan usage through the official Sign in with ChatGPT flow (vendored @siwc/local).
 * Credentials stay inside the SDK's encrypted store; this class never sees or returns tokens.
 */
export class ChatGptProvider implements AIProvider {
  readonly id = 'chatgpt' as const
  readonly name = 'ChatGPT'
  readonly kind = 'subscription' as const
  readonly authType = 'oauth' as const
  readonly local = false

  private session: SessionState = { status: 'disconnected', sharing: false }
  private models: ModelInfo[] | null = null
  /** Models that rejected image input at runtime (subscription_sharing_unsupported_capability). */
  private readonly noVision = new Set<string>()
  private readonly controllers = new Set<AbortController>()
  private readonly sessionListeners = new Set<(session: SessionState) => void>()
  private unsubscribe: (() => void) | null = null
  private lastNotifiedKey = ''
  private sessionInFlight: Promise<SessionState> | null = null
  private sessionFetchedAt = 0

  constructor(private readonly deps: ChatGptProviderDeps) {}

  getIntegration(): IntegrationInfo {
    return { enabled: this.deps.integrationEnabled, note: this.deps.integrationNote }
  }

  onSessionChange(listener: (session: SessionState) => void): () => void {
    this.sessionListeners.add(listener)
    this.attach()
    return () => this.sessionListeners.delete(listener)
  }

  private client(): ChatGPTClient {
    if (!this.deps.integrationEnabled) {
      throw new ProviderError('chatgpt', 'UNSUPPORTED', { message: this.deps.integrationNote ?? 'Интеграция ChatGPT отключена.' })
    }
    const client = this.deps.getClient()
    if (!client) throw new ProviderError('chatgpt', 'AUTH', { message: 'Безопасное хранилище недоступно — вход в ChatGPT невозможен.' })
    this.attach()
    return client
  }

  private attach(): void {
    if (this.unsubscribe || !this.deps.integrationEnabled) return
    const client = this.deps.getClient()
    if (!client) return
    this.unsubscribe = client.subscribe((session) => {
      this.session = session
      // The SDK publishes on every getSession(); only real changes may reach listeners, otherwise
      // listener → status refresh → getSession → publish would loop and starve the SDK's file lock.
      const key = sessionKey(session)
      if (key === this.lastNotifiedKey) return
      this.lastNotifiedKey = key
      for (const listener of this.sessionListeners) listener(session)
    })
  }

  async connect(options: { reconsent?: boolean } = {}): Promise<void> {
    try {
      await this.client().signIn(options.reconsent ? { reconsent: true } : {})
      this.sessionFetchedAt = 0
      this.models = null
      this.noVision.clear()
    } catch (err) {
      throw mapChatGptError(err)
    }
  }

  cancelConnect(): void {
    this.deps.getClient()?.cancelSignIn()
  }

  async disconnect(): Promise<void> {
    this.cancelRequest()
    this.models = null
    this.sessionFetchedAt = 0
    try {
      await this.client().disconnect()
    } catch (err) {
      const e = err as { code?: unknown }
      // Local credentials are removed even when remote revocation cannot be confirmed.
      if (e?.code === 'revocation_failed') {
        throw new ProviderError('chatgpt', 'NETWORK', {
          message: 'Локально вы вышли, но отзыв доступа на сервере не подтверждён. Отключите Snap Notes в настройках ChatGPT.',
          canFallback: true,
          originalError: err
        })
      }
      throw mapChatGptError(err)
    }
  }

  async refreshAuthentication(): Promise<void> {
    // The SDK refreshes near expiry on the next authenticated call; listing models is a free call.
    await this.getAvailableModels({ refresh: true })
  }

  async getSession(): Promise<SessionState> {
    if (!this.deps.integrationEnabled) return { status: 'disconnected', sharing: false }
    const client = this.deps.getClient()
    if (!client) return { status: 'disconnected', sharing: false }
    this.attach()
    if (this.sessionInFlight) return this.sessionInFlight
    if (Date.now() - this.sessionFetchedAt < SESSION_CACHE_MS) return this.session
    this.sessionInFlight = client
      .getSession()
      .then((session) => {
        this.session = session
        this.sessionFetchedAt = Date.now()
        return session
      })
      .catch(() => this.session)
      .finally(() => {
        this.sessionInFlight = null
      })
    return this.sessionInFlight
  }

  async isAvailable(): Promise<boolean> {
    const session = await this.getSession()
    return session.status === 'connected' && session.sharing
  }

  async getConnectionInfo(): Promise<ProviderConnectionInfo> {
    const session = await this.getSession()
    return {
      connected: session.status === 'connected',
      connecting: session.status === 'connecting',
      planUsageEnabled: session.status === 'connected' && session.sharing,
      ...(session.identity?.name ? { accountName: session.identity.name } : {}),
      ...(session.identity?.email ? { accountEmail: session.identity.email } : {})
    }
  }

  async getAvailableModels(options: { refresh?: boolean; cachedOnly?: boolean } = {}): Promise<ModelInfo[]> {
    if (options.cachedOnly) return this.models ?? []
    if (this.models && !options.refresh) return this.models
    if (!(await this.isAvailable())) return this.models ?? []
    try {
      const listed = await this.client().listModels()
      this.models = listed.map((m) => ({
        id: m.slug,
        displayName: m.displayName,
        ...(m.inputModalities ? { vision: m.inputModalities.includes('image') } : {})
      }))
      return this.models
    } catch (err) {
      throw mapChatGptError(err)
    }
  }

  getCapabilities(): ProviderCapabilities {
    return CAPABILITIES
  }

  /** Models to try for a request, in server order (docs: "preserves the server's ordering"). */
  private candidateModels(vision: boolean): string[] {
    const selected = this.deps.getModel()
    const models = this.models ?? []
    if (selected && selected !== 'auto') {
      const known = models.find((m) => m.id === selected)
      if (vision && (known?.vision === false || this.noVision.has(selected))) return []
      return [selected]
    }
    const usable = models.filter((m) => !vision || (m.vision !== false && !this.noVision.has(m.id)))
    // Prefer models the catalog explicitly marks as accepting images, then unknown ones.
    const sorted = vision ? [...usable.filter((m) => m.vision === true), ...usable.filter((m) => m.vision === undefined)] : usable
    return sorted.slice(0, 2).map((m) => m.id)
  }

  async canServeVision(): Promise<boolean> {
    if (!this.models) {
      try {
        await this.getAvailableModels()
      } catch {
        return false
      }
    }
    return this.candidateModels(true).length > 0
  }

  runVision(request: VisionRequest): Promise<ProviderResult> {
    return this.run(request)
  }

  runText(request: TextRequest): Promise<ProviderResult> {
    return this.run(request)
  }

  runStructuredOutput(request: VisionRequest | TextRequest): Promise<ProviderResult> {
    // The plan-usage route rejects most optional Responses fields, so JSON is requested in the prompt.
    return this.run({ ...request, json: true })
  }

  private async run(request: VisionRequest | TextRequest): Promise<ProviderResult> {
    const vision = isVisionRequest(request)
    if (!this.models) await this.getAvailableModels()
    const candidates = this.candidateModels(vision)
    if (candidates.length === 0) {
      throw new ProviderError('chatgpt', vision ? 'UNSUPPORTED' : 'MODEL_UNAVAILABLE', {
        message: vision ? 'Нет модели ChatGPT, принимающей изображения.' : 'Нет доступной модели ChatGPT.'
      })
    }

    const content: ResponseContentPart[] = [{ type: 'input_text', text: request.prompt }]
    if (vision) content.push({ type: 'input_image', image_url: `data:${request.mimeType};base64,${request.image.toString('base64')}` })

    let lastError: ProviderError | null = null
    for (const model of candidates) {
      const controller = new AbortController()
      this.controllers.add(controller)
      const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal
      try {
        const result = await this.client().streamResponse({
          model,
          input: [{ role: 'user', content }],
          ...(request.instructions ? { instructions: request.instructions } : {}),
          signal
        })
        return { text: result.text.trim(), model, usage: result.usage }
      } catch (err) {
        const error = mapChatGptError(err)
        lastError = error
        const unsupportedImage = (err as { code?: unknown })?.code === 'subscription_sharing_unsupported_capability'
        if (vision && unsupportedImage) {
          // Learned from the provider, not guessed: this model does not take images here.
          this.noVision.add(model)
          continue
        }
        throw error
      } finally {
        this.controllers.delete(controller)
      }
    }
    throw lastError ?? new ProviderError('chatgpt', 'UNSUPPORTED')
  }

  async getUsage(): Promise<Partial<ProviderUsage>> {
    // Sign in with ChatGPT exposes no remaining/reset numbers; usage is managed in ChatGPT settings.
    return {
      source: 'План ChatGPT',
      accuracy: 'unknown',
      windows: [],
      note: 'Остаток использования управляется ChatGPT',
      manageUrl: CHATGPT_MANAGE_USAGE_URL
    }
  }

  getRateLimits(): UsageWindow[] {
    return []
  }

  cancelRequest(): void {
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      const session = await this.getSession()
      if (session.status !== 'connected') return { ok: false, message: 'Не подключено' }
      if (!session.sharing) return { ok: false, message: 'Вход выполнен, но использование плана не разрешено' }
      const models = await this.getAvailableModels({ refresh: true })
      return { ok: true, message: `Подключено · моделей: ${models.length}` }
    } catch (err) {
      const error = mapChatGptError(err)
      return { ok: false, message: error.message, errorCode: error.code }
    }
  }
}
