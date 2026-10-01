const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })
const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })
const full = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })

/** "14:32" today, "вчера", "12 сент." this year, "12 сент. 2024 г." otherwise. */
export function formatNoteDate(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  const today = new Date(now)
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  if (ts >= startOfToday) return time.format(d)
  if (ts >= startOfToday - 86_400_000) return 'вчера'
  if (d.getFullYear() === today.getFullYear()) return dayMonth.format(d)
  return full.format(d)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

export function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}
