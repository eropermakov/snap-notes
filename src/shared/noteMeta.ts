/**
 * Note metadata added in 1.6: favorite, colour, tags, auto-created flag. Everything here is pure so
 * the main process (migration, IPC validation) and the renderer (UI, filters) share one definition.
 */

export const NOTE_COLORS = ['default', 'coral', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple'] as const
export type NoteColor = (typeof NOTE_COLORS)[number]

/** Names shown next to the swatches: colour is never the only carrier of meaning. */
export const NOTE_COLOR_LABELS: Record<NoteColor, string> = {
  default: 'Без цвета',
  coral: 'Коралловый',
  orange: 'Оранжевый',
  yellow: 'Жёлтый',
  green: 'Зелёный',
  teal: 'Бирюзовый',
  blue: 'Синий',
  purple: 'Фиолетовый'
}

export const MAX_TAGS_PER_NOTE = 20
export const MAX_TAG_LENGTH = 32

export function normalizeColor(value: unknown): NoteColor {
  return typeof value === 'string' && (NOTE_COLORS as readonly string[]).includes(value) ? (value as NoteColor) : 'default'
}

/** "#Работа " → "работа". Spaces inside become "-". Empty when nothing usable is left. */
export function normalizeTag(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/^[\s#]+/, '')
    .replace(/[,;]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/#/g, '')
    .toLowerCase()
    .slice(0, MAX_TAG_LENGTH)
    .replace(/-+$/, '')
}

/** Unique, normalized, in first-seen order. Accepts anything (disk, IPC). */
export function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of value) {
    const tag = normalizeTag(raw)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    result.push(tag)
    if (result.length >= MAX_TAGS_PER_NOTE) break
  }
  return result
}

/** "#работа, важно  идеи" → ["работа", "важно", "идеи"]. */
export function parseTagInput(text: string): string[] {
  return normalizeTags(text.split(/[\s,;]+/))
}

export function addTags(current: string[], extra: string[]): string[] {
  return normalizeTags([...current, ...extra])
}

export function removeTags(current: string[], remove: string[]): string[] {
  const drop = new Set(normalizeTags(remove))
  return current.filter((tag) => !drop.has(tag))
}

export interface NoteMeta {
  favorite: boolean
  color: NoteColor
  tags: string[]
  autoCreated?: boolean
  titleManual?: boolean
}

/** True when a stored note predates 1.6 (lacks the metadata fields) and must be rewritten. */
export function needsMetaMigration(stored: Record<string, unknown>): boolean {
  return typeof stored.favorite !== 'boolean' || typeof stored.color !== 'string' || !Array.isArray(stored.tags)
}

/** Safe defaults for old notes; valid values of new notes are kept (and re-normalized). */
export function readNoteMeta(stored: Record<string, unknown>): NoteMeta {
  return {
    favorite: stored.favorite === true,
    color: normalizeColor(stored.color),
    tags: normalizeTags(stored.tags),
    ...(stored.autoCreated === true ? { autoCreated: true } : {}),
    ...(stored.titleManual === true ? { titleManual: true } : {})
  }
}

/**
 * Pinning, favoriting and colouring are organisation, not editing: they must not change "last
 * modified" (and so must not reshuffle the list sorted by it). Text, title, emoji and tags do.
 */
export function isContentPatch(patch: Record<string, unknown>): boolean {
  return ['title', 'body', 'emoji', 'tags', 'blocks'].some((key) => key in patch)
}
