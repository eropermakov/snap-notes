import {
  LIMIT_LOW_REMAINING_PERCENT,
  type ProviderErrorInfo,
  type ProviderId,
  type ProviderStatus,
  type ProviderUsage,
  type UsageAccuracy,
  type UsageWindow
} from '../../shared/providers'
import type { ProviderError } from './errors'

/** Internal recheck delays when a provider blocks without saying for how long. Never shown as a reset time. */
const RECHECK_MS = {
  planLimit: 15 * 60_000,
  rateLimit: 60_000,
  network: 30_000,
  down: 60_000,
  noPermission: 10 * 60_000
}

/** Windows that reset this soon are transient (per-minute buckets) and never make a provider LIMIT_LOW. */
const TRANSIENT_WINDOW_MS = 60_000
const MAX_TIMER_MS = 2_147_000_000

interface Block {
  status: ProviderStatus
  /** When the router may try again (UTC ms). Infinity = until reconfigured. */
  until: number
  /** Reset reported by the provider (or documented policy); the only reset time the UI may show. */
  resetAt?: number
  resetAccuracy?: UsageAccuracy
}

interface RuntimeState {
  local: boolean
  configured: boolean
  auth: 'AUTH_REQUIRED' | 'AUTH_EXPIRED' | null
  block: Block | null
  lastError?: ProviderErrorInfo
  usage: ProviderUsage
}

export interface UsageServiceOptions {
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export type UsageListener = (providerId: ProviderId) => void
export type ResetListener = (providerId: ProviderId) => void

function emptyUsage(providerId: ProviderId, now: number): ProviderUsage {
  return {
    providerId,
    source: '',
    accuracy: 'unknown',
    windows: [],
    updatedAt: now,
    status: 'UNKNOWN'
  }
}

export class UsageService {
  private readonly states = new Map<ProviderId, RuntimeState>()
  private readonly listeners = new Set<UsageListener>()
  private readonly resetListeners = new Set<ResetListener>()
  private readonly now: () => number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void
  private timer: unknown = null
  private online = true

  constructor(options: UsageServiceOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  }

  register(providerId: ProviderId, options: { local: boolean; configured: boolean }): void {
    const existing = this.states.get(providerId)
    if (existing) {
      existing.local = options.local
      existing.configured = options.configured
    } else {
      this.states.set(providerId, {
        local: options.local,
        configured: options.configured,
        auth: null,
        block: null,
        usage: emptyUsage(providerId, this.now())
      })
    }
    this.emit(providerId)
  }

  onChange(listener: UsageListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Called when a block/reset expires, so the owner can run an ordinary status refresh. */
  onReset(listener: ResetListener): () => void {
    this.resetListeners.add(listener)
    return () => this.resetListeners.delete(listener)
  }

  setOnline(online: boolean): void {
    if (this.online === online) return
    this.online = online
    for (const id of this.states.keys()) this.emit(id)
  }

  isOnline(): boolean {
    return this.online
  }

  setConfigured(providerId: ProviderId, configured: boolean): void {
    const state = this.require(providerId)
    state.configured = configured
    this.emit(providerId)
  }

  /** Connection-level auth state (OAuth). null = authorized. */
  setAuthState(providerId: ProviderId, auth: 'AUTH_REQUIRED' | 'AUTH_EXPIRED' | null): void {
    const state = this.require(providerId)
    state.auth = auth
    this.emit(providerId)
  }

  /** Forget blocks and errors, e.g. after a new API key or a reconnect. */
  resetProvider(providerId: ProviderId): void {
    const state = this.require(providerId)
    state.block = null
    state.auth = null
    state.lastError = undefined
    state.usage = emptyUsage(providerId, this.now())
    this.reschedule()
    this.emit(providerId)
  }

  /** Static usage facts from the provider (e.g. "managed by ChatGPT", "no limits"). */
  setProviderUsage(providerId: ProviderId, partial: Partial<ProviderUsage>): void {
    const state = this.require(providerId)
    state.usage = {
      ...state.usage,
      ...partial,
      providerId,
      windows: partial.windows ?? state.usage.windows,
      updatedAt: partial.updatedAt ?? this.now(),
      stale: false
    }
    this.emit(providerId)
  }

  recordSuccess(providerId: ProviderId, windows?: UsageWindow[], source?: string): void {
    const state = this.require(providerId)
    const now = this.now()
    state.block = null
    state.lastError = undefined
    if (state.auth === 'AUTH_EXPIRED') state.auth = null
    if (windows && windows.length > 0) {
      const merged = new Map(state.usage.windows.map((w) => [w.id, w]))
      for (const w of windows) merged.set(w.id, w)
      state.usage = {
        ...state.usage,
        windows: Array.from(merged.values()),
        accuracy: 'provider_reported',
        source: source ?? state.usage.source,
        updatedAt: now,
        stale: false,
        resetAt: undefined,
        resetAccuracy: undefined
      }
      // A window the provider reports as exhausted blocks until its reported reset.
      const exhausted = windows
        .filter((w) => w.remaining === 0 && w.resetAt !== undefined && w.resetAt > now)
        .sort((a, b) => (b.resetAt ?? 0) - (a.resetAt ?? 0))[0]
      if (exhausted?.resetAt) {
        state.block = { status: 'RATE_LIMITED', until: exhausted.resetAt, resetAt: exhausted.resetAt, resetAccuracy: 'provider_reported' }
      }
    } else {
      state.usage = { ...state.usage, updatedAt: now, stale: false, resetAt: undefined, resetAccuracy: undefined }
    }
    this.reschedule()
    this.emit(providerId)
  }

  recordError(error: ProviderError): void {
    if (error.code === 'CANCELLED') return
    const state = this.require(error.provider)
    const now = this.now()
    const retryAfterMs = error.retryAfter !== undefined ? error.retryAfter * 1000 : undefined
    const reportedReset = error.resetAt ?? (retryAfterMs !== undefined ? now + retryAfterMs : undefined)
    const resetAccuracy: UsageAccuracy =
      error.resetAt !== undefined && error.resetIsEstimate && retryAfterMs === undefined ? 'estimated' : 'provider_reported'
    state.lastError = error.toInfo(now)

    switch (error.code) {
      case 'AUTH':
        state.block = { status: 'AUTH_REQUIRED', until: Infinity }
        break
      case 'AUTH_EXPIRED':
        state.auth = 'AUTH_EXPIRED'
        break
      case 'NO_PERMISSION':
        state.block = { status: 'AUTH_REQUIRED', until: now + RECHECK_MS.noPermission }
        break
      case 'PLAN_LIMIT':
      case 'INSUFFICIENT_CREDITS':
        state.block = {
          status: 'LIMIT_REACHED',
          until: reportedReset ?? now + RECHECK_MS.planLimit,
          ...(reportedReset !== undefined ? { resetAt: reportedReset, resetAccuracy } : {})
        }
        break
      case 'RATE_LIMIT':
        state.block = {
          status: 'RATE_LIMITED',
          until: reportedReset ?? now + RECHECK_MS.rateLimit,
          ...(reportedReset !== undefined ? { resetAt: reportedReset, resetAccuracy } : {})
        }
        break
      case 'NETWORK':
        state.block = { status: 'UNAVAILABLE', until: now + RECHECK_MS.network }
        break
      case 'TIMEOUT':
      case 'PROVIDER_DOWN':
        state.block = { status: 'UNAVAILABLE', until: reportedReset ?? now + RECHECK_MS.down }
        break
      default:
        // MODEL_UNAVAILABLE / INVALID_RESPONSE / UNSUPPORTED / UNKNOWN: visible as ERROR, not blocking.
        break
    }
    if (state.block) {
      state.usage = {
        ...state.usage,
        resetAt: state.block.resetAt,
        resetAccuracy: state.block.resetAccuracy,
        updatedAt: now
      }
    }
    this.reschedule()
    this.emit(error.provider)
  }

  getStatus(providerId: ProviderId): ProviderStatus {
    const state = this.states.get(providerId)
    if (!state) return 'UNKNOWN'
    return this.deriveStatus(state)
  }

  getUsage(providerId: ProviderId): ProviderUsage {
    const state = this.require(providerId)
    return { ...state.usage, status: this.deriveStatus(state), windows: state.usage.windows.map((w) => ({ ...w })) }
  }

  getLastError(providerId: ProviderId): ProviderErrorInfo | undefined {
    return this.states.get(providerId)?.lastError
  }

  /** Lowest provider-reported remaining percentage across non-transient windows, if any. */
  getRemainingPercent(providerId: ProviderId): number | undefined {
    const state = this.states.get(providerId)
    if (!state) return undefined
    return this.meaningfulRemaining(state)
  }

  /** Marks usage stale and lets the owner refresh (e.g. when the Usage Center opens). */
  markStale(providerId: ProviderId): void {
    const state = this.require(providerId)
    state.usage = { ...state.usage, stale: true }
    this.emit(providerId)
  }

  /** Expires due blocks. Called by the internal timer; exposed for tests. */
  tick(): void {
    const now = this.now()
    const expired: ProviderId[] = []
    for (const [id, state] of this.states) {
      if (state.block && state.block.until <= now) {
        state.block = null
        // The error that caused the block is resolved by the reset; the provider is back in the pool.
        state.lastError = undefined
        state.usage = { ...state.usage, resetAt: undefined, resetAccuracy: undefined, stale: true }
        expired.push(id)
      }
    }
    this.reschedule()
    for (const id of expired) {
      this.emit(id)
      for (const listener of this.resetListeners) {
        try {
          listener(id)
        } catch {
          /* a listener must not break expiry of other providers */
        }
      }
    }
  }

  dispose(): void {
    if (this.timer !== null) this.clearTimer(this.timer)
    this.timer = null
    this.listeners.clear()
    this.resetListeners.clear()
  }

  private deriveStatus(state: RuntimeState): ProviderStatus {
    if (state.auth) return state.auth
    if (!state.local && !this.online) return 'OFFLINE'
    if (state.block && state.block.until > this.now()) return state.block.status
    if (!state.configured) return 'AUTH_REQUIRED'
    const remaining = this.meaningfulRemaining(state)
    if (remaining !== undefined && remaining < LIMIT_LOW_REMAINING_PERCENT) return 'LIMIT_LOW'
    if (state.lastError && !['CANCELLED'].includes(state.lastError.code)) return 'ERROR'
    return 'AVAILABLE'
  }

  private meaningfulRemaining(state: RuntimeState): number | undefined {
    const now = this.now()
    let lowest: number | undefined
    for (const w of state.usage.windows) {
      if (w.remainingPercent === undefined) continue
      if (w.accuracy !== 'exact' && w.accuracy !== 'provider_reported') continue
      if (w.resetAt !== undefined && w.resetAt - now <= TRANSIENT_WINDOW_MS) continue
      lowest = lowest === undefined ? w.remainingPercent : Math.min(lowest, w.remainingPercent)
    }
    return lowest
  }

  private reschedule(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer)
      this.timer = null
    }
    let next = Infinity
    for (const state of this.states.values()) {
      if (state.block && state.block.until < next) next = state.block.until
    }
    if (!Number.isFinite(next)) return
    const delay = Math.min(MAX_TIMER_MS, Math.max(0, next - this.now()) + 250)
    this.timer = this.setTimer(() => {
      this.timer = null
      this.tick()
    }, delay)
  }

  private emit(providerId: ProviderId): void {
    for (const listener of this.listeners) {
      try {
        listener(providerId)
      } catch {
        /* listeners are UI plumbing; never break state updates */
      }
    }
  }

  private require(providerId: ProviderId): RuntimeState {
    let state = this.states.get(providerId)
    if (!state) {
      state = { local: false, configured: false, auth: null, block: null, usage: emptyUsage(providerId, this.now()) }
      this.states.set(providerId, state)
    }
    return state
  }
}
