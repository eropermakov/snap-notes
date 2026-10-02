import {
  isBlockingStatus,
  type AiPreference,
  type Capability,
  type OperationType,
  type ProviderCapabilities,
  type ProviderErrorCode,
  type ProviderId,
  type ProviderStatus
} from '../../shared/providers'
import { ProviderError, normalizeThrown } from './errors'

/** What the router knows about a provider at decision time. */
export interface RouteCandidate {
  id: ProviderId
  local: boolean
  /** Feature flag on, configured and authorized. */
  usable: boolean
  capabilities: ProviderCapabilities
  /** For vision: whether the provider's current model selection can take an image. */
  canServeVision: boolean
  status: ProviderStatus
  /** Provider-reported remaining %, only when known. */
  remainingPercent?: number
  /** Static ranking facts from the provider catalog (see providerCatalog.ts). */
  costClass?: 'free' | 'included' | 'advanced' | 'paid'
  qualityRank?: number
  speedRank?: number
}

export interface RouteRequest {
  operation: OperationType
  requiredCapabilities: Capability[]
  /** 'offline' = nothing may leave the computer. */
  privacyMode: 'offline' | 'cloud'
  networkOnline: boolean
  /** User priority for cloud providers (drag & drop order). */
  userPriority: ProviderId[]
  /** What Automatic optimizes for. Missing = 'custom' (the user's own order). */
  prefer?: AiPreference
  /** Manual provider choice; the router respects it. */
  preferredProvider: ProviderId | null
  protectLowLimits: boolean
  autoFallback: boolean
  /** Append local providers (Tesseract) as the last fallback. */
  includeLocalFallback: boolean
}

export type SkipReason = 'integration_disabled' | 'not_configured' | 'capability' | 'status' | 'privacy' | 'offline'

export interface RoutePlan {
  order: ProviderId[]
  skipped: { id: ProviderId; reason: SkipReason; status?: ProviderStatus }[]
}

function hasCapabilities(candidate: RouteCandidate, required: Capability[]): boolean {
  for (const capability of required) {
    if (!candidate.capabilities[capability]) return false
    if (capability === 'vision' && !candidate.canServeVision) return false
  }
  return true
}

/** Pure provider selection. Deterministic for a given input. */
export function planRoute(request: RouteRequest, candidates: RouteCandidate[]): RoutePlan {
  const skipped: RoutePlan['skipped'] = []
  const eligible: RouteCandidate[] = []

  for (const candidate of candidates) {
    if (!candidate.local && request.privacyMode === 'offline') {
      skipped.push({ id: candidate.id, reason: 'privacy' })
      continue
    }
    if (!candidate.local && !request.networkOnline) {
      skipped.push({ id: candidate.id, reason: 'offline' })
      continue
    }
    if (!candidate.usable) {
      skipped.push({ id: candidate.id, reason: 'not_configured' })
      continue
    }
    if (!hasCapabilities(candidate, request.requiredCapabilities)) {
      skipped.push({ id: candidate.id, reason: 'capability' })
      continue
    }
    if (candidate.local && !request.includeLocalFallback && request.preferredProvider !== candidate.id) {
      continue
    }
    eligible.push(candidate)
  }

  const priorityIndex = (id: ProviderId): number => {
    const index = request.userPriority.indexOf(id)
    return index === -1 ? request.userPriority.length : index
  }

  const byPriority = (a: RouteCandidate, b: RouteCandidate): number => priorityIndex(a.id) - priorityIndex(b.id)
  const costGroup = (c: RouteCandidate): number => (c.costClass === 'paid' ? 2 : c.costClass === 'advanced' ? 1 : 0)
  // The user's order always breaks ties, so "Prefer free" keeps their ranking inside each group.
  const byStrategy = (a: RouteCandidate, b: RouteCandidate): number => {
    switch (request.prefer) {
      case 'free':
        return costGroup(a) - costGroup(b) || byPriority(a, b)
      case 'quality':
        return (a.qualityRank ?? 99) - (b.qualityRank ?? 99) || byPriority(a, b)
      case 'speed':
        return (a.speedRank ?? 99) - (b.speedRank ?? 99) || byPriority(a, b)
      default:
        return byPriority(a, b)
    }
  }
  const cloud = eligible.filter((c) => !c.local).sort(byStrategy)
  const local = eligible.filter((c) => c.local)

  // A manual choice goes first, even if it is currently blocked: the user asked for it explicitly.
  const preferred = request.preferredProvider ? eligible.find((c) => c.id === request.preferredProvider) : undefined

  const available: RouteCandidate[] = []
  for (const candidate of cloud) {
    if (candidate === preferred) continue
    if (isBlockingStatus(candidate.status)) {
      skipped.push({ id: candidate.id, reason: 'status', status: candidate.status })
      continue
    }
    available.push(candidate)
  }

  let ordered = available
  if (request.protectLowLimits) {
    // Stable partition: providers the provider itself reports as nearly exhausted go after the rest.
    const healthy = available.filter((c) => c.status !== 'LIMIT_LOW')
    const low = available.filter((c) => c.status === 'LIMIT_LOW')
    ordered = [...healthy, ...low]
  }

  let order: ProviderId[] = [
    ...(preferred ? [preferred.id] : []),
    ...ordered.map((c) => c.id),
    // Local providers (Tesseract) always come last.
    ...local.filter((c) => c !== preferred).map((c) => c.id)
  ]

  if (!request.autoFallback) order = order.slice(0, 1)
  return { order, skipped }
}

export interface Attempt {
  provider: ProviderId
  error: ProviderError
}

export interface FallbackOutcome<T> {
  value: T
  provider: ProviderId
  attempts: Attempt[]
}

export class AllProvidersFailedError extends Error {
  readonly attempts: Attempt[]
  readonly lastCode: ProviderErrorCode
  constructor(attempts: Attempt[]) {
    super(attempts.length ? attempts[attempts.length - 1].error.message : 'Нет доступных источников распознавания.')
    this.name = 'AllProvidersFailedError'
    this.attempts = attempts
    this.lastCode = attempts.length ? attempts[attempts.length - 1].error.code : 'UNSUPPORTED'
  }
}

/**
 * Tries providers in order. A ProviderError with canFallback moves on to the next provider;
 * anything else (cancellation) stops immediately. onError runs before moving on, so usage state
 * is updated (e.g. LIMIT_REACHED) before the next attempt.
 */
export async function runWithFallback<T>(
  order: ProviderId[],
  attempt: (provider: ProviderId) => Promise<T>,
  onError?: (error: ProviderError) => void
): Promise<FallbackOutcome<T>> {
  const attempts: Attempt[] = []
  for (const provider of order) {
    try {
      const value = await attempt(provider)
      return { value, provider, attempts }
    } catch (err) {
      const error = normalizeThrown(provider, err)
      onError?.(error)
      attempts.push({ provider, error })
      if (!error.canFallback) break
    }
  }
  throw new AllProvidersFailedError(attempts)
}
