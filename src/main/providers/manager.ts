import { PROVIDER_CATALOG } from '../../shared/providerCatalog'
import {
  PROVIDER_NAMES,
  type AiSettings,
  type Capability,
  type OperationType,
  type ProviderId,
  type ProviderPublicState,
  type RoutingNotice
} from '../../shared/providers'
import { ProviderError, normalizeThrown } from './errors'
import { AllProvidersFailedError, planRoute, runWithFallback, type Attempt, type RouteCandidate } from './router'
import type { UsageService } from './usageService'
import type { ActivityLog } from './activityLog'
import type { AIProvider, ProviderResult } from './types'

export interface AiLogEntry {
  provider: ProviderId
  model: string
  operation: OperationType
  durationMs: number
  status: 'ok' | 'error'
  fallback: boolean
  errorCode?: string
  /** Only present when the user enabled debug content logging. */
  contentPreview?: string
}

export interface AiLogger {
  log(entry: AiLogEntry): void
}

export interface ExecuteOptions {
  operation: OperationType
  requiredCapabilities: Capability[]
  imageSent: boolean
  /** Add Tesseract as the final fallback (only meaningful for vision OCR). */
  includeLocalFallback: boolean
  /** Size of the image about to be sent, so providers with an inline-size limit can opt out. */
  imageBytes?: number
  run: (provider: AIProvider) => Promise<ProviderResult>
  /** Run on exactly this provider (still subject to privacy/offline rules), e.g. a JSON repair retry. */
  onlyProvider?: ProviderId
  /** Providers to skip ("Retry with another AI": everything except the one behind the current text). */
  excludeProviders?: ProviderId[]
  signal?: AbortSignal
}

export interface ExecuteOutcome {
  result: ProviderResult
  provider: ProviderId
  attempts: Attempt[]
  notice: RoutingNotice | null
}

export interface ProviderManagerDeps {
  usage: UsageService
  activity: ActivityLog
  getSettings: () => AiSettings
  logger?: AiLogger
  now?: () => number
}

/**
 * Registry + routing + bookkeeping. The OCR pipeline and the UI talk only to this class, never to a
 * concrete SDK. Adding a provider = implementing AIProvider and registering it here.
 */
export class ProviderManager {
  private readonly providers = new Map<ProviderId, AIProvider>()
  private readonly listeners = new Set<() => void>()
  private readonly now: () => number

  constructor(private readonly deps: ProviderManagerDeps) {
    this.now = deps.now ?? (() => Date.now())
    deps.usage.onChange(() => this.emit())
    deps.usage.onReset((id) => void this.refreshStatus(id))
  }

  register(provider: AIProvider): void {
    this.providers.set(provider.id, provider)
    this.deps.usage.register(provider.id, { local: provider.local, configured: false })
    void this.refreshStatus(provider.id)
  }

  get(id: ProviderId): AIProvider | undefined {
    return this.providers.get(id)
  }

  list(): AIProvider[] {
    return Array.from(this.providers.values())
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        /* UI plumbing must not break provider bookkeeping */
      }
    }
  }

  /** Re-reads configuration/auth and static usage facts. No paid requests. */
  async refreshStatus(id: ProviderId): Promise<void> {
    const provider = this.providers.get(id)
    if (!provider) return
    const integration = provider.getIntegration()
    let available = false
    try {
      available = integration.enabled && (await provider.isAvailable())
    } catch {
      available = false
    }
    this.deps.usage.setConfigured(id, available)
    try {
      const staticUsage = await provider.getUsage()
      if (staticUsage) this.deps.usage.setProviderUsage(id, staticUsage)
    } catch {
      /* usage facts are optional */
    }
    this.emit()
  }

  async refreshAll(): Promise<void> {
    await Promise.all(Array.from(this.providers.keys()).map((id) => this.refreshStatus(id)))
  }

  /** One background catalog fetch per configured provider (free list endpoints), e.g. after start-up. */
  async warmModels(): Promise<void> {
    await Promise.all(
      this.list().map(async (provider) => {
        if (provider.local || !provider.getIntegration().enabled) return
        if (!(await provider.isAvailable().catch(() => false))) return
        await provider.getAvailableModels().catch(() => undefined)
      })
    )
    this.emit()
  }

  async publicState(id: ProviderId, today = this.deps.activity.summary()): Promise<ProviderPublicState | null> {
    const provider = this.providers.get(id)
    if (!provider) return null
    const integration = provider.getIntegration()
    const [connection, models] = await Promise.all([
      provider.getConnectionInfo().catch(() => ({ connected: false })),
      // UI state must never trigger network requests: cached catalog only.
      provider.getAvailableModels({ cachedOnly: true }).catch(() => [])
    ])
    const settings = this.deps.getSettings()
    const configured = integration.enabled && (await provider.isAvailable().catch(() => false))
    return {
      id,
      name: provider.name,
      kind: provider.kind,
      authType: provider.authType,
      local: provider.local,
      integrationEnabled: integration.enabled,
      ...(integration.note ? { integrationNote: integration.note } : {}),
      configured,
      connection,
      capabilities: provider.getCapabilities(),
      status: this.deps.usage.getStatus(id),
      usage: this.deps.usage.getUsage(id),
      models,
      selectedModel: settings.models[id] ?? 'auto',
      ...(this.deps.usage.getLastError(id) ? { lastError: this.deps.usage.getLastError(id) } : {}),
      ...(today.byProvider[id] && !provider.local
        ? { localUsage: { requests: today.byProvider[id]!.requests, failures: today.byProvider[id]!.failures, tokens: today.byProvider[id]!.totalTokens } }
        : {})
    }
  }

  async publicStates(): Promise<ProviderPublicState[]> {
    const settings = this.deps.getSettings()
    const order: ProviderId[] = [...settings.priority.filter((id) => this.providers.has(id))]
    for (const id of this.providers.keys()) if (!order.includes(id) && id !== 'tesseract') order.push(id)
    if (this.providers.has('tesseract')) order.push('tesseract')
    const today = this.deps.activity.summary()
    const states = await Promise.all(order.map((id) => this.publicState(id, today)))
    return states.filter((s): s is ProviderPublicState => s !== null)
  }

  private async candidates(requiresVision: boolean, imageBytes?: number): Promise<RouteCandidate[]> {
    const result: RouteCandidate[] = []
    for (const provider of this.providers.values()) {
      const integration = provider.getIntegration()
      let usable = false
      try {
        usable = integration.enabled && (await provider.isAvailable())
      } catch {
        usable = false
      }
      let canServeVision = false
      if (usable && requiresVision) {
        try {
          canServeVision = await provider.canServeVision(imageBytes)
        } catch {
          canServeVision = false
        }
      }
      result.push({
        id: provider.id,
        local: provider.local,
        usable,
        capabilities: provider.getCapabilities(),
        canServeVision,
        status: this.deps.usage.getStatus(provider.id),
        remainingPercent: this.deps.usage.getRemainingPercent(provider.id),
        costClass: PROVIDER_CATALOG[provider.id]?.costClass,
        qualityRank: PROVIDER_CATALOG[provider.id]?.qualityRank,
        speedRank: PROVIDER_CATALOG[provider.id]?.speedRank
      })
    }
    return result
  }

  /** Plans a route for the current settings (used by the UI to show "what would be used"). */
  async plan(
    requiredCapabilities: Capability[],
    includeLocalFallback: boolean,
    operation: OperationType = 'OCR_VISION',
    imageBytes?: number
  ) {
    const settings = this.deps.getSettings()
    return planRoute(
      {
        operation,
        requiredCapabilities,
        privacyMode: settings.mode === 'offline' ? 'offline' : 'cloud',
        networkOnline: this.deps.usage.isOnline(),
        userPriority: settings.priority,
        prefer: settings.prefer,
        preferredProvider: settings.preferredProvider,
        protectLowLimits: settings.protectLowLimits,
        autoFallback: settings.autoFallback,
        includeLocalFallback
      },
      await this.candidates(requiredCapabilities.includes('vision'), imageBytes)
    )
  }

  /**
   * Routes one request: plan → try providers in order → update usage state on each failure →
   * record activity → return the first success. Offline mode never reaches a cloud provider,
   * because planRoute excludes them before any request is built.
   */
  async execute(options: ExecuteOptions): Promise<ExecuteOutcome> {
    const plan = await this.plan(options.requiredCapabilities, options.includeLocalFallback, options.operation, options.imageBytes)
    if (options.onlyProvider) {
      const provider = this.providers.get(options.onlyProvider)
      const settings = this.deps.getSettings()
      const blockedByPrivacy = provider && !provider.local && (settings.mode === 'offline' || !this.deps.usage.isOnline())
      plan.order = provider && !blockedByPrivacy ? [options.onlyProvider] : []
    }
    if (options.excludeProviders?.length) {
      plan.order = plan.order.filter((id) => !options.excludeProviders?.includes(id))
    }
    if (plan.order.length === 0) {
      throw new AllProvidersFailedError([])
    }
    const settings = this.deps.getSettings()
    let attemptIndex = 0

    const outcome = await runWithFallback(
      plan.order,
      async (id) => {
        const provider = this.providers.get(id)
        if (!provider) throw new ProviderError(id, 'UNSUPPORTED')
        const fallbackUsed = attemptIndex > 0
        attemptIndex += 1
        const started = this.now()
        try {
          const result = await options.run(provider)
          const durationMs = this.now() - started
          this.deps.usage.recordSuccess(id, result.rateLimits, result.rateLimitSource)
          this.deps.activity.record({
            provider: id,
            model: result.model,
            timestamp: started,
            operationType: options.operation,
            durationMs,
            success: true,
            ...(result.usage?.inputTokens !== undefined ? { inputTokens: result.usage.inputTokens } : {}),
            ...(result.usage?.outputTokens !== undefined ? { outputTokens: result.usage.outputTokens } : {}),
            ...(result.usage?.totalTokens !== undefined ? { totalTokens: result.usage.totalTokens } : {}),
            imageSent: options.imageSent,
            fallbackUsed
          })
          this.deps.logger?.log({
            provider: id,
            model: result.model,
            operation: options.operation,
            durationMs,
            status: 'ok',
            fallback: fallbackUsed,
            ...(settings.debugContentLogging ? { contentPreview: result.text.slice(0, 500) } : {})
          })
          return result
        } catch (err) {
          const error = normalizeThrown(id, err)
          const durationMs = this.now() - started
          this.deps.activity.record({
            provider: id,
            model: settings.models[id] ?? 'auto',
            timestamp: started,
            operationType: options.operation,
            durationMs,
            success: false,
            errorCode: error.code,
            imageSent: options.imageSent,
            fallbackUsed
          })
          this.deps.logger?.log({
            provider: id,
            model: settings.models[id] ?? 'auto',
            operation: options.operation,
            durationMs,
            status: 'error',
            fallback: fallbackUsed,
            errorCode: error.code
          })
          throw error
        }
      },
      (error) => this.deps.usage.recordError(error)
    )

    return {
      result: outcome.value,
      provider: outcome.provider,
      attempts: outcome.attempts,
      notice: this.buildNotice(outcome.provider, outcome.attempts)
    }
  }

  private buildNotice(used: ProviderId, attempts: Attempt[]): RoutingNotice | null {
    const skipped = attempts
      .filter((a) => a.error.code !== 'CANCELLED')
      .map((a) => {
        const usage = this.deps.usage.getUsage(a.provider)
        const resetAt = usage.resetAccuracy === 'provider_reported' || usage.resetAccuracy === 'exact' ? usage.resetAt : undefined
        return { provider: a.provider, name: PROVIDER_NAMES[a.provider], code: a.error.code, ...(resetAt ? { resetAt } : {}) }
      })
    if (skipped.length === 0) return null
    const usedProvider = this.providers.get(used)
    return {
      usedProvider: used,
      usedProviderName: usedProvider?.name ?? PROVIDER_NAMES[used],
      skipped,
      offlineFallback: usedProvider?.local === true
    }
  }

  cancelAll(): void {
    for (const provider of this.providers.values()) provider.cancelRequest()
  }
}
