import Store from 'electron-store'

interface UsageEntry {
  date: string
  count: number
}

interface UsageShape {
  usage: Record<string, UsageEntry>
}

const store = new Store<UsageShape>({ name: 'usage', defaults: { usage: {} } })

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

export function recordUsage(keyId: string): void {
  const usage = store.get('usage')
  const today = todayKey()
  const entry = usage[keyId]
  usage[keyId] = entry && entry.date === today ? { date: today, count: entry.count + 1 } : { date: today, count: 1 }
  store.set('usage', usage)
}

export function getAllUsageToday(): Record<string, number> {
  const usage = store.get('usage')
  const today = todayKey()
  const result: Record<string, number> = {}
  for (const [id, entry] of Object.entries(usage)) {
    result[id] = entry.date === today ? entry.count : 0
  }
  return result
}

export function clearUsageForKey(keyId: string): void {
  const usage = store.get('usage')
  delete usage[keyId]
  store.set('usage', usage)
}
