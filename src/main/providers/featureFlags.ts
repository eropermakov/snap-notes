/**
 * Integration feature flags. Each provider integration can be switched off independently, e.g. for a
 * distribution build that is not eligible for a provider program.
 *
 * Build-time override: MAIN_VITE_DISABLED_INTEGRATIONS="chatgptPlanAuth,groqApi" (electron-vite env).
 * Runtime override (development): SNAP_NOTES_DISABLED_INTEGRATIONS with the same format.
 */
export interface IntegrationFlags {
  /**
   * Sign in with ChatGPT + ChatGPT plan usage. OpenAI offers it to open-source / locally hosted apps;
   * paid or remotely hosted apps must apply via OpenAI's interest form first. Turn this off for any
   * build that does not meet OpenAI's eligibility rules — the UI then offers the OpenAI API instead.
   */
  chatgptPlanAuth: boolean
  /**
   * Claude Pro/Max subscription sign-in. Anthropic's documentation does not permit third-party apps to
   * offer claude.ai login or route requests through plan credentials ("unless previously approved").
   * There is no approved integration, so this stays false and there is no code path that would use it.
   */
  claudeSubscriptionAuth: boolean
  openaiApi: boolean
  anthropicApi: boolean
  geminiApi: boolean
  groqApi: boolean
  openrouterApi: boolean
  mistralApi: boolean
  cerebrasApi: boolean
  cloudflareAi: boolean
  nvidiaNim: boolean
  cohereApi: boolean
  huggingfaceApi: boolean
  /** Optional Advanced provider: your own OCR endpoint on Modal. */
  modalOcr: boolean
  tesseract: boolean
}

export const CHATGPT_PLAN_INTEGRATION_ENABLED = true

export const DEFAULT_FLAGS: IntegrationFlags = {
  chatgptPlanAuth: CHATGPT_PLAN_INTEGRATION_ENABLED,
  claudeSubscriptionAuth: false,
  openaiApi: true,
  anthropicApi: true,
  geminiApi: true,
  groqApi: true,
  openrouterApi: true,
  mistralApi: true,
  cerebrasApi: true,
  cloudflareAi: true,
  nvidiaNim: true,
  cohereApi: true,
  huggingfaceApi: true,
  modalOcr: true,
  tesseract: true
}

function parseList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function buildTimeDisabled(): string | undefined {
  try {
    return (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.MAIN_VITE_DISABLED_INTEGRATIONS
  } catch {
    return undefined
  }
}

export function resolveFlags(
  disabledBuildTime = buildTimeDisabled(),
  disabledRuntime = typeof process !== 'undefined' ? process.env.SNAP_NOTES_DISABLED_INTEGRATIONS : undefined
): IntegrationFlags {
  const flags: IntegrationFlags = { ...DEFAULT_FLAGS }
  for (const name of [...parseList(disabledBuildTime), ...parseList(disabledRuntime)]) {
    if (name in flags) (flags as unknown as Record<string, boolean>)[name] = false
  }
  // Never enable an integration that has no permitted implementation.
  flags.claudeSubscriptionAuth = false
  return flags
}
