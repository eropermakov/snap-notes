import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, renameSync, rmSync, existsSync, mkdirSync } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type { SecretStore } from './secretStore'

interface SecretsFile {
  version: 1
  /** Format identifier: every entry is Electron safeStorage ciphertext (DPAPI on Windows). */
  provider: 'electron-safestorage'
  entries: Record<string, string>
}

const SAFE_ID = /^[a-zA-Z0-9_-]{1,100}$/

/**
 * API keys, encrypted per entry with Electron safeStorage. The file holds only ciphertext; decrypted
 * values exist only in main-process memory while a request is being made.
 */
export class ElectronSecretStore implements SecretStore {
  private readonly file: string
  private cache: SecretsFile | null = null

  constructor(directory = app.getPath('userData')) {
    this.file = path.join(directory, 'secrets.json')
  }

  isSecure(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  has(id: string): boolean {
    return Boolean(this.read().entries[id])
  }

  get(id: string): string | null {
    const cipher = this.read().entries[id]
    if (!cipher || !this.isSecure()) return null
    try {
      return safeStorage.decryptString(Buffer.from(cipher, 'base64'))
    } catch {
      return null
    }
  }

  set(id: string, value: string): boolean {
    if (!SAFE_ID.test(id) || !this.isSecure()) return false
    let cipher: string
    try {
      cipher = safeStorage.encryptString(value).toString('base64')
    } catch {
      return false
    }
    const next: SecretsFile = { ...this.read(), entries: { ...this.read().entries, [id]: cipher } }
    try {
      this.write(next)
    } catch {
      return false
    }
    // Verify from disk, not from the in-memory copy.
    this.cache = null
    return this.get(id) === value
  }

  delete(id: string): void {
    const current = this.read()
    if (!(id in current.entries)) return
    const entries = { ...current.entries }
    delete entries[id]
    this.write({ ...current, entries })
  }

  private read(): SecretsFile {
    if (this.cache) return this.cache
    const empty: SecretsFile = { version: 1, provider: 'electron-safestorage', entries: {} }
    if (!existsSync(this.file)) {
      this.cache = empty
      return empty
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf-8')) as Partial<SecretsFile>
      if (parsed.version !== 1 || parsed.provider !== 'electron-safestorage' || !parsed.entries || typeof parsed.entries !== 'object') {
        // Unknown format: keep the file untouched and behave as empty rather than overwriting it.
        this.cache = { ...empty }
        return this.cache
      }
      const entries: Record<string, string> = {}
      for (const [key, value] of Object.entries(parsed.entries)) {
        if (SAFE_ID.test(key) && typeof value === 'string') entries[key] = value
      }
      this.cache = { version: 1, provider: 'electron-safestorage', entries }
      return this.cache
    } catch {
      this.cache = { ...empty }
      return this.cache
    }
  }

  private write(data: SecretsFile): void {
    mkdirSync(path.dirname(this.file), { recursive: true })
    const temp = `${this.file}.${randomUUID()}.tmp`
    try {
      writeFileSync(temp, JSON.stringify(data), { encoding: 'utf-8', mode: 0o600 })
      renameSync(temp, this.file)
    } finally {
      rmSync(temp, { force: true })
    }
    this.cache = data
  }
}
