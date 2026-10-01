import { describe, expect, it } from 'vitest'
import { migrateAiSettings, normalizeAiSettings } from '../../src/main/providers/settingsMigration'
import { MemorySecretStore } from '../../src/main/providers/secretStore'
import { resolveFlags } from '../../src/main/providers/featureFlags'
import type { AiKeyEntry } from '../../src/shared/types'

const LEGACY: AiKeyEntry[] = [
  { id: 'g1', provider: 'groq', label: 'Groq', apiKey: 'gsk_live_1' },
  { id: 'm1', provider: 'gemini', label: 'Gemini', apiKey: 'AIza_1' },
  { id: 'm2', provider: 'gemini', label: 'Gemini #2', apiKey: 'AIza_2' },
  { id: 'l1', provider: 'local', label: 'Локально', apiKey: 'local' },
  { id: 'e1', provider: 'gemini', label: 'empty', apiKey: '  ' }
]

describe('migrateAiSettings', () => {
  it('moves every key to secure storage, verifies it, and only then drops the plaintext', () => {
    const secrets = new MemorySecretStore()
    const result = migrateAiSettings({ aiKeys: LEGACY, useHybridPipeline: false }, secrets)
    expect(result.migratedKeyIds).toEqual(['g1', 'm1', 'm2'])
    expect(result.remainingLegacyKeys).toEqual([])
    expect(secrets.get('g1')).toBe('gsk_live_1')
    expect(secrets.get('m2')).toBe('AIza_2')
    expect(result.providerKeys.gemini).toEqual([
      { id: 'm1', label: 'Gemini' },
      { id: 'm2', label: 'Gemini #2' }
    ])
    expect(JSON.stringify(result.providerKeys)).not.toContain('AIza')
  })

  it('keeps the plaintext key when secure storage is unavailable (never loses a key)', () => {
    const result = migrateAiSettings({ aiKeys: LEGACY }, new MemorySecretStore(false))
    expect(result.migratedKeyIds).toEqual([])
    expect(result.remainingLegacyKeys.map((k) => k.id)).toEqual(['g1', 'm1', 'm2'])
    expect(result.providerKeys.groq).toEqual([{ id: 'g1', label: 'Groq' }])
  })

  it('keeps the plaintext key when the verification read-back fails', () => {
    const result = migrateAiSettings({ aiKeys: LEGACY }, new MemorySecretStore(true, true))
    expect(result.failedKeyIds).toEqual(['g1', 'm1', 'm2'])
    expect(result.remainingLegacyKeys).toHaveLength(3)
  })

  it('preserves the user order and behavior: hybrid → economy, keys → best', () => {
    const economy = migrateAiSettings({ aiKeys: LEGACY, useHybridPipeline: true }, new MemorySecretStore())
    expect(economy.ai.mode).toBe('economy')
    expect(economy.ai.priority.slice(0, 4)).toEqual(['chatgpt', 'claude', 'groq', 'gemini'])
    expect(economy.ai.priority).not.toContain('tesseract')

    expect(migrateAiSettings({ aiKeys: LEGACY }, new MemorySecretStore()).ai.mode).toBe('best')
    expect(migrateAiSettings({ aiKeys: [] }, new MemorySecretStore()).ai.mode).toBe('balanced')
  })

  it('is idempotent', () => {
    const secrets = new MemorySecretStore()
    const first = migrateAiSettings({ aiKeys: LEGACY }, secrets)
    const second = migrateAiSettings(
      { aiKeys: first.remainingLegacyKeys, ai: first.ai, providerKeys: first.providerKeys },
      secrets
    )
    expect(second.changed).toBe(false)
    expect(second.providerKeys).toEqual(first.providerKeys)
  })

  it('normalizes hostile or stale settings', () => {
    const ai = normalizeAiSettings({
      mode: 'turbo' as never,
      priority: ['groq', 'groq', 'tesseract', 'unknown' as never],
      preferredProvider: 'evil' as never
    })
    expect(ai.mode).toBe('balanced')
    expect(ai.priority[0]).toBe('groq')
    expect(ai.priority.filter((p) => p === 'groq')).toHaveLength(1)
    expect(ai.priority).not.toContain('tesseract')
    expect(ai.preferredProvider).toBeNull()
  })
})

describe('feature flags', () => {
  it('integrations can be disabled independently', () => {
    const flags = resolveFlags('chatgptPlanAuth', 'groqApi')
    expect(flags.chatgptPlanAuth).toBe(false)
    expect(flags.groqApi).toBe(false)
    expect(flags.geminiApi).toBe(true)
  })
  it('Claude subscription auth can never be switched on', () => {
    expect(resolveFlags(undefined, undefined).claudeSubscriptionAuth).toBe(false)
  })
})
