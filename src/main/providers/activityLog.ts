import type { ActivityRecord, ActivitySummary, ProviderId } from '../../shared/providers'

/**
 * Snap Notes' own LOCAL ACTIVITY: what this app sent, when, and how it went. These numbers are never
 * provider "remaining usage" and must never be used to guess one.
 */
export interface ActivityPersistence {
  load(): ActivityRecord[]
  save(records: ActivityRecord[]): void
}

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const MAX_RECORDS = 5000
const SAVE_DEBOUNCE_MS = 2000

export function localDayKey(timestamp: number): string {
  const d = new Date(timestamp)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

export class ActivityLog {
  private records: ActivityRecord[]
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly persistence: ActivityPersistence,
    private readonly now: () => number = () => Date.now()
  ) {
    let loaded: ActivityRecord[] = []
    try {
      loaded = persistence.load().filter(isRecord)
    } catch {
      loaded = []
    }
    this.records = this.prune(loaded)
  }

  record(entry: ActivityRecord): void {
    this.records.push(entry)
    if (this.records.length > MAX_RECORDS * 1.1) this.records = this.prune(this.records)
    this.scheduleSave()
  }

  summary(day = localDayKey(this.now())): ActivitySummary {
    const byProvider: ActivitySummary['byProvider'] = {}
    for (const r of this.records) {
      if (localDayKey(r.timestamp) !== day) continue
      const entry = byProvider[r.provider] ?? { requests: 0, failures: 0, totalTokens: 0 }
      entry.requests += 1
      if (!r.success) entry.failures += 1
      const tokens = r.totalTokens ?? (r.inputTokens ?? 0) + (r.outputTokens ?? 0)
      entry.totalTokens += tokens
      byProvider[r.provider] = entry
    }
    return { day, byProvider }
  }

  recent(limit = 50, provider?: ProviderId): ActivityRecord[] {
    const list = provider ? this.records.filter((r) => r.provider === provider) : this.records
    return list.slice(-limit).reverse()
  }

  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    try {
      this.persistence.save(this.records)
    } catch {
      /* activity is best-effort; it must never break a recognition */
    }
  }

  clear(): void {
    this.records = []
    this.flush()
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.flush()
    }, SAVE_DEBOUNCE_MS)
  }

  private prune(records: ActivityRecord[]): ActivityRecord[] {
    const cutoff = this.now() - RETENTION_MS
    return records.filter((r) => r.timestamp >= cutoff).slice(-MAX_RECORDS)
  }
}

function isRecord(value: unknown): value is ActivityRecord {
  if (!value || typeof value !== 'object') return false
  const r = value as Record<string, unknown>
  return typeof r.provider === 'string' && typeof r.timestamp === 'number' && typeof r.success === 'boolean'
}
