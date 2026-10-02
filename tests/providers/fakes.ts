import { vi } from 'vitest'
import {
  DEFAULT_AI_SETTINGS,
  type AiSettings,
  type ModelInfo,
  type ProviderCapabilities,
  type ProviderConnectionInfo,
  type ProviderId,
  type ProviderUsage,
  type UsageWindow
} from '../../src/shared/providers'
import { ProviderError } from '../../src/main/providers/errors'
import { UsageService } from '../../src/main/providers/usageService'
import { ActivityLog } from '../../src/main/providers/activityLog'
import { ProviderManager } from '../../src/main/providers/manager'
import type {
  AIProvider,
  HealthCheckResult,
  IntegrationInfo,
  ProviderResult,
  TextRequest,
  VisionRequest
} from '../../src/main/providers/types'

export const FULL_CAPS: ProviderCapabilities = {
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

export type Behavior = (request: VisionRequest | TextRequest) => Promise<ProviderResult>

/** Scriptable provider: every call goes through `behavior`, and every request is recorded. */
export class FakeProvider implements AIProvider {
  readonly kind
  readonly authType
  readonly name: string
  readonly calls: (VisionRequest | TextRequest)[] = []
  available = true
  enabled = true
  vision = true
  behavior: Behavior

  constructor(
    readonly id: ProviderId,
    readonly local = false,
    behavior?: Behavior,
    public capabilities: ProviderCapabilities = FULL_CAPS
  ) {
    this.name = id
    this.kind = local ? ('local' as const) : ('api' as const)
    this.authType = local ? ('none' as const) : ('api_key' as const)
    this.behavior = behavior ?? (async () => ({ text: `{"blocks":[{"type":"paragraph","text":"from ${id}"}]}`, model: `${id}-model` }))
  }

  getIntegration(): IntegrationInfo {
    return { enabled: this.enabled }
  }
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {
    this.available = false
  }
  async refreshAuthentication(): Promise<void> {}
  async isAvailable(): Promise<boolean> {
    return this.available
  }
  async getConnectionInfo(): Promise<ProviderConnectionInfo> {
    return { connected: this.available }
  }
  async getAvailableModels(_options?: { refresh?: boolean; cachedOnly?: boolean }): Promise<ModelInfo[]> {
    return [{ id: `${this.id}-model`, displayName: `${this.id} model`, vision: this.vision }]
  }
  getCapabilities(): ProviderCapabilities {
    return this.capabilities
  }
  async canServeVision(): Promise<boolean> {
    return this.vision
  }
  runVision(request: VisionRequest): Promise<ProviderResult> {
    this.calls.push(request)
    return this.behavior(request)
  }
  runText(request: TextRequest): Promise<ProviderResult> {
    this.calls.push(request)
    return this.behavior(request)
  }
  runStructuredOutput(request: VisionRequest | TextRequest): Promise<ProviderResult> {
    this.calls.push({ ...request, json: true })
    return this.behavior(request)
  }
  async getUsage(): Promise<Partial<ProviderUsage> | null> {
    return null
  }
  getRateLimits(): UsageWindow[] {
    return []
  }
  cancelRequest(): void {}
  async healthCheck(): Promise<HealthCheckResult> {
    return { ok: this.available, message: '' }
  }
}

export function failWith(provider: ProviderId, code: ConstructorParameters<typeof ProviderError>[1], extra: object = {}): Behavior {
  return async () => {
    throw new ProviderError(provider, code, extra)
  }
}

export interface Harness {
  manager: ProviderManager
  usage: UsageService
  activity: ActivityLog
  settings: AiSettings
  clock: { now: number }
  saved: unknown[]
}

export function createHarness(providers: FakeProvider[], settings: Partial<AiSettings> = {}): Harness {
  const clock = { now: Date.UTC(2026, 8, 30, 12, 0, 0) }
  const now = (): number => clock.now
  const usage = new UsageService({ now, setTimer: () => null, clearTimer: () => {} })
  const saved: unknown[] = []
  const activity = new ActivityLog({ load: () => [], save: (records) => saved.push(records) }, now)
  const aiSettings: AiSettings = { ...DEFAULT_AI_SETTINGS, ...settings }
  const manager = new ProviderManager({ usage, activity, getSettings: () => aiSettings, now })
  for (const provider of providers) manager.register(provider)
  return { manager, usage, activity, settings: aiSettings, clock, saved }
}

/** Lets registration's async refreshStatus settle. */
export async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

export { vi }
