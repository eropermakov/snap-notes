import { describe, expect, it } from 'vitest'
import { migrateAiSettings, normalizeAiSettings, normalizePriority } from '../../src/main/providers/settingsMigration'
import { MemorySecretStore } from '../../src/main/providers/secretStore'
import { API_KEY_PROVIDERS, DEFAULT_PRIORITY, PROVIDER_IDS } from '../../src/shared/providers'
import { EMPTY_PROVIDER_KEYS } from '../../src/shared/types'
import { extraFields, fieldSecretId } from '../../src/shared/providerCatalog'

const GEMINI = { id: 'legacy-gem', provider: 'gemini' as const, label: 'Gemini', apiKey: 'AIza-legacy-1' }
const GROQ = { id: 'legacy-groq', provider: 'groq' as const, label: 'Groq', apiKey: 'gsk_legacy_2' }

describe('upgrade from ≤1.3.1 / 1.4.0 with the new providers', () => {
  it('moves the existing Gemini and Groq keys to secure storage without re-entry', () => {
    const secrets = new MemorySecretStore()
    const result = migrateAiSettings({ aiKeys: [GEMINI, GROQ] }, secrets)
    expect(secrets.get('legacy-gem')).toBe('AIza-legacy-1')
    expect(secrets.get('legacy-groq')).toBe('gsk_legacy_2')
    // Plaintext copies are dropped only after the read-back verified.
    expect(result.remainingLegacyKeys).toEqual([])
    expect(result.migratedKeyIds.sort()).toEqual(['legacy-gem', 'legacy-groq'])
    expect(result.providerKeys.gemini).toEqual([{ id: 'legacy-gem', label: 'Gemini' }])
    expect(result.providerKeys.groq).toEqual([{ id: 'legacy-groq', label: 'Groq' }])
  })

  it('has an (empty) key list for every provider, including all new ones', () => {
    const result = migrateAiSettings({ aiKeys: [GEMINI] }, new MemorySecretStore())
    for (const provider of API_KEY_PROVIDERS) expect(result.providerKeys[provider], provider).toBeDefined()
    expect(Object.keys(EMPTY_PROVIDER_KEYS).sort()).toEqual([...API_KEY_PROVIDERS].sort())
    expect(result.providerKeys.openrouter).toEqual([])
    expect(result.providerKeys.modal).toEqual([])
  })

  it('is idempotent: a second run changes nothing and loses nothing', () => {
    const secrets = new MemorySecretStore()
    const first = migrateAiSettings({ aiKeys: [GEMINI, GROQ] }, secrets)
    const second = migrateAiSettings({ aiKeys: first.remainingLegacyKeys, ai: first.ai, providerKeys: first.providerKeys }, secrets)
    expect(second.providerKeys).toEqual(first.providerKeys)
    expect(secrets.get('legacy-gem')).toBe('AIza-legacy-1')
    expect(second.failedKeyIds).toEqual([])
  })

  it('if secure storage fails, the plaintext keys are kept (never lost)', () => {
    const secrets = new MemorySecretStore(true, true) // writes fail
    const result = migrateAiSettings({ aiKeys: [GEMINI, GROQ] }, secrets)
    expect(result.remainingLegacyKeys.map((k) => k.id).sort()).toEqual(['legacy-gem', 'legacy-groq'])
    expect(result.failedKeyIds).toHaveLength(2)
  })

  it('1.4.0 AI settings gain the new providers and the "free" preference; the user\'s choices survive', () => {
    const ai = normalizeAiSettings({
      mode: 'economy',
      priority: ['groq', 'gemini', 'chatgpt'],
      preferredProvider: 'gemini',
      models: { gemini: 'gemini-x' },
      autoFallback: false
    })
    expect(ai.prefer).toBe('free')
    expect(ai.mode).toBe('economy')
    expect(ai.preferredProvider).toBe('gemini')
    expect(ai.models.gemini).toBe('gemini-x')
    expect(ai.autoFallback).toBe(false)
    expect(ai.priority.slice(0, 3)).toEqual(['groq', 'gemini', 'chatgpt'])
    for (const id of DEFAULT_PRIORITY) expect(ai.priority).toContain(id)
    expect(ai.priority).not.toContain('tesseract')
  })

  it('rejects an unknown preference value and unknown provider ids', () => {
    expect(normalizeAiSettings({ prefer: 'cheapest' as never }).prefer).toBe('free')
    expect(normalizeAiSettings({ prefer: 'speed' }).prefer).toBe('speed')
    expect(normalizePriority(['mistral', 'bogus', 'mistral', 'tesseract'])[0]).toBe('mistral')
    expect(normalizePriority(['mistral', 'bogus']).filter((id) => id === 'mistral')).toHaveLength(1)
    expect(normalizeAiSettings({ models: { openrouter: 'x', bogus: 'y' } as never }).models).toEqual({ openrouter: 'x' })
  })

  it('every id in the default priority is a known provider and Tesseract is never in it', () => {
    for (const id of DEFAULT_PRIORITY) expect(PROVIDER_IDS).toContain(id)
    expect(DEFAULT_PRIORITY).not.toContain('tesseract')
  })
})

describe('credential fields live in the same secure store', () => {
  it('field secret ids are valid store ids and never collide with key ids', () => {
    const safe = /^[a-zA-Z0-9_-]{1,100}$/
    for (const provider of API_KEY_PROVIDERS) {
      for (const field of extraFields(provider)) {
        expect(fieldSecretId(provider, field.id)).toMatch(safe)
        expect(fieldSecretId(provider, field.id).startsWith('field-')).toBe(true)
      }
    }
    expect(extraFields('cloudflare').map((f) => f.id)).toEqual(['accountId'])
    expect(extraFields('modal').map((f) => f.id).sort()).toEqual(['endpoint', 'tokenId'])
  })
})
