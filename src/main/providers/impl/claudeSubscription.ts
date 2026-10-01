import type { ModelInfo, ProviderCapabilities, ProviderConnectionInfo, ProviderUsage, UsageWindow } from '../../../shared/providers'
import { ProviderError } from '../errors'
import type { AIProvider, HealthCheckResult, IntegrationInfo, ProviderResult } from '../types'

export const CLAUDE_MANAGE_USAGE_URL = 'https://claude.ai/settings/usage'

/**
 * Placeholder for Claude Pro/Max subscription use.
 *
 * Anthropic's Agent SDK and Claude Code legal docs (checked 2026-09-30) state that third-party
 * developers may not offer claude.ai login or route requests through Free/Pro/Max plan credentials
 * unless previously approved, and may not collect or intermediate Claude.ai credentials. There is no
 * approved integration for Snap Notes, so this provider never authenticates, never reads Claude Code's
 * credentials and never runs requests. The UI points users to the Anthropic API instead.
 */
export class ClaudeSubscriptionProvider implements AIProvider {
  readonly id = 'claude' as const
  readonly name = 'Claude'
  readonly kind = 'subscription' as const
  readonly authType = 'oauth' as const
  readonly local = false

  getIntegration(): IntegrationInfo {
    return {
      enabled: false,
      note:
        'Подписка Claude Pro/Max работает только в продуктах Anthropic (Claude, Claude Code). Anthropic не разрешает сторонним приложениям вход через claude.ai и использование лимитов подписки. Для Snap Notes подключите Anthropic API.'
    }
  }

  private unsupported(): ProviderError {
    return new ProviderError('claude', 'UNSUPPORTED', { message: this.getIntegration().note })
  }

  async connect(): Promise<void> {
    throw this.unsupported()
  }
  async disconnect(): Promise<void> {}
  async refreshAuthentication(): Promise<void> {}
  async isAvailable(): Promise<boolean> {
    return false
  }
  async getConnectionInfo(): Promise<ProviderConnectionInfo> {
    return { connected: false }
  }
  async getAvailableModels(): Promise<ModelInfo[]> {
    return []
  }
  getCapabilities(): ProviderCapabilities {
    return {
      vision: false,
      text: false,
      structuredOutput: false,
      ocrCleanup: false,
      tables: false,
      codeRecognition: false,
      translation: false,
      noteActions: false
    }
  }
  async canServeVision(): Promise<boolean> {
    return false
  }
  async runVision(): Promise<ProviderResult> {
    throw this.unsupported()
  }
  async runText(): Promise<ProviderResult> {
    throw this.unsupported()
  }
  async runStructuredOutput(): Promise<ProviderResult> {
    throw this.unsupported()
  }
  async getUsage(): Promise<Partial<ProviderUsage>> {
    return {
      source: 'Claude',
      accuracy: 'unknown',
      windows: [],
      note: 'Использование подписки видно только в Claude',
      manageUrl: CLAUDE_MANAGE_USAGE_URL
    }
  }
  getRateLimits(): UsageWindow[] {
    return []
  }
  cancelRequest(): void {}
  async healthCheck(): Promise<HealthCheckResult> {
    return { ok: false, message: this.getIntegration().note ?? 'Недоступно' }
  }
}
