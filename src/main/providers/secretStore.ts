/**
 * Secret storage for API keys. Secrets never leave the main process and are never written as
 * plaintext: the Electron implementation (secretStoreElectron.ts) encrypts with Electron safeStorage,
 * which on Windows uses DPAPI bound to the current Windows user.
 *
 * ChatGPT OAuth credentials are not stored here: the Sign in with ChatGPT SDK keeps its own encrypted
 * state, using the same safeStorage-backed encryption provider.
 */
export interface SecretStore {
  /** OS-backed encryption is available. When false, set() refuses to write. */
  isSecure(): boolean
  has(id: string): boolean
  get(id: string): string | null
  /** Writes, then reads back and compares. Returns true only when the round-trip verified. */
  set(id: string, value: string): boolean
  delete(id: string): void
}

/** In-memory store for tests. */
export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>()
  constructor(
    private readonly secure = true,
    private readonly failWrites = false
  ) {}
  isSecure(): boolean {
    return this.secure
  }
  has(id: string): boolean {
    return this.values.has(id)
  }
  get(id: string): string | null {
    return this.values.get(id) ?? null
  }
  set(id: string, value: string): boolean {
    if (!this.secure || this.failWrites) return false
    this.values.set(id, value)
    return this.values.get(id) === value
  }
  delete(id: string): void {
    this.values.delete(id)
  }
}
