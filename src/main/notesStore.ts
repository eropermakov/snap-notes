import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { Note } from '../shared/types'
import { looksLikeHtml, plainTextToHtml } from '../shared/htmlText'
import { NOTE_FORMAT_VERSION, blocksToHtml, htmlToBlocks, normalizeBlocks, type Block, type OcrSource } from '../shared/blocks'
import { sanitizeNoteHtml } from './htmlSanitize'
import { deleteNoteImages, deleteAllImages, deleteNoteImage } from './imageStore'
import { logEvent } from './logger'

let notesDir: string | null = null
let cache: Map<string, Note> = new Map()

function getNotesDir(): string {
  if (!notesDir) {
    notesDir = path.join(app.getPath('userData'), 'notes')
  }
  return notesDir
}

function notePath(id: string): string {
  return path.join(getNotesDir(), `${id}.json`)
}

async function persist(note: Note): Promise<void> {
  // Atomic replace: a crash mid-write never leaves a half-written note.
  const target = notePath(note.id)
  const temp = `${target}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temp, JSON.stringify(note, null, 2), 'utf-8')
    await fs.rename(temp, target)
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {})
  }
}

/** Blocks derived from the note's HTML body (the editor still edits HTML). */
function withBlocks(note: Note): Note {
  return { ...note, version: NOTE_FORMAT_VERSION, blocks: htmlToBlocks(note.body) }
}

const SAFE_KEY = /^[a-zA-Z0-9_-]{1,64}$/

function sanitizeSources(value: unknown): Record<string, OcrSource> {
  const result: Record<string, OcrSource> = {}
  if (!value || typeof value !== 'object') return result
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!SAFE_KEY.test(key) || !raw || typeof raw !== 'object') continue
    const s = raw as Record<string, unknown>
    const str = (v: unknown, max = 300): string | undefined => (typeof v === 'string' && v ? v.slice(0, max) : undefined)
    const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
    const imageId = str(s.imageId, 64)
    const source: OcrSource = {
      id: key,
      capturedAt: num(s.capturedAt) ?? 0,
      ...(imageId && /^[a-zA-Z0-9-]+$/.test(imageId) ? { imageId } : {}),
      ...(num(s.imageWidth) !== undefined ? { imageWidth: num(s.imageWidth) } : {}),
      ...(num(s.imageHeight) !== undefined ? { imageHeight: num(s.imageHeight) } : {}),
      ...(str(s.appName) ? { appName: str(s.appName) } : {}),
      ...(str(s.windowTitle) ? { windowTitle: str(s.windowTitle) } : {}),
      ...(str(s.url, 2000) ? { url: str(s.url, 2000) } : {}),
      ...(str(s.method, 80) ? { method: str(s.method, 80) } : {}),
      ...(str(s.model, 120) ? { model: str(s.model, 120) } : {}),
      ...(str(s.mode, 40) ? { mode: str(s.mode, 40) } : {})
    }
    result[key] = source
  }
  return result
}

/**
 * Copies the given note files, unchanged, into userData/backups/notes-v1-<timestamp>/ before the
 * first rewrite to format v2. Returns false if the copy could not be completed.
 */
async function backupBeforeMigration(dir: string, files: string[]): Promise<boolean> {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupDir = path.join(app.getPath('userData'), 'backups', `notes-v1-${stamp}`)
    await fs.mkdir(backupDir, { recursive: true })
    for (const file of files) await fs.copyFile(path.join(dir, file), path.join(backupDir, file))
    const copied = (await fs.readdir(backupDir)).length
    logEvent('notes', { migration: 'v1->v2', notes: files.length, backup: path.basename(backupDir), copied })
    return copied === files.length
  } catch (err) {
    logEvent('notes', { migration: 'v1->v2', backupFailed: err instanceof Error ? err.name : 'unknown' })
    return false
  }
}

export async function initNotesStore(): Promise<void> {
  const dir = getNotesDir()
  await fs.mkdir(dir, { recursive: true })
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'))
  cache = new Map()
  const loaded: { file: string; parsed: Partial<Note> }[] = []
  for (const file of files) {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(dir, file), 'utf-8')) as Partial<Note>
      if (parsed && typeof parsed.id === 'string') loaded.push({ file, parsed })
    } catch {
      /* corrupt file: left untouched on disk */
    }
  }

  // v1 → v2: back up the originals first. If the backup fails, notes are converted in memory only
  // and the files on disk stay exactly as they were (the next edit of a note saves it as v2).
  const legacy = loaded.filter((l) => l.parsed.version !== NOTE_FORMAT_VERSION)
  const mayRewrite = legacy.length === 0 || (await backupBeforeMigration(dir, legacy.map((l) => l.file)))

  for (const { parsed } of loaded) {
    let body = parsed.body ?? ''
    if (body && !looksLikeHtml(body)) body = plainTextToHtml(body)
    const sources = sanitizeSources(parsed.sources)
    const note: Note = {
      ...withBlocks({
        id: parsed.id as string,
        title: parsed.title ?? '',
        body,
        emoji: parsed.emoji ?? null,
        pinned: parsed.pinned ?? false,
        createdAt: parsed.createdAt ?? Date.now(),
        updatedAt: parsed.updatedAt ?? Date.now(),
        deletedAt: parsed.deletedAt ?? null
      }),
      ...(Object.keys(sources).length ? { sources } : {})
    }
    const isLegacy = parsed.version !== NOTE_FORMAT_VERSION
    if ((!isLegacy || mayRewrite) && JSON.stringify(note) !== JSON.stringify(parsed)) {
      await persist(note)
    }
    cache.set(note.id, note)
  }
}

export function listNotes(): Note[] {
  return Array.from(cache.values())
    .filter((n) => n.deletedAt === null)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.updatedAt - a.updatedAt
    })
}

export function listTrash(): Note[] {
  return Array.from(cache.values())
    .filter((n) => n.deletedAt !== null)
    .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
}

export function getNote(id: string): Note | undefined {
  return cache.get(id)
}

export async function createNote(partial?: Partial<Note>): Promise<Note> {
  const now = Date.now()
  const note: Note = {
    id: randomUUID(),
    title: '',
    body: '',
    emoji: null,
    pinned: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...partial
  }
  if (note.body) note.body = sanitizeNoteHtml(note.body)
  const stored = withBlocks(note)
  cache.set(stored.id, stored)
  await persist(stored)
  return stored
}

export async function updateNote(id: string, patch: Partial<Note>): Promise<Note | null> {
  const existing = cache.get(id)
  if (!existing) return null
  // Sources are only changed by appendBlocks/removeSource (main process), never by a renderer patch.
  const { blocks: patchBlocks, sources: _sources, version: _version, ...rest } = patch
  let updated: Note = { ...existing, ...rest, id: existing.id, updatedAt: Date.now() }
  if (patchBlocks !== undefined) {
    // Blocks are the source of truth for this change: the editor HTML is rendered from them.
    const blocks = normalizeBlocks(patchBlocks)
    updated = { ...updated, version: NOTE_FORMAT_VERSION, blocks, body: sanitizeNoteHtml(blocksToHtml(blocks)) }
  } else if (patch.body !== undefined) {
    updated = withBlocks({ ...updated, body: sanitizeNoteHtml(patch.body) })
  }
  cache.set(id, updated)
  await persist(updated)
  return updated
}

/**
 * Appends recognized blocks (and their capture metadata) to a note without re-rendering the
 * existing HTML, so the user's own formatting stays exactly as it was.
 */
export async function appendBlocks(id: string, blocks: Block[], source?: OcrSource): Promise<Note | null> {
  const existing = cache.get(id)
  if (!existing) return null
  const body = sanitizeNoteHtml(existing.body + blocksToHtml(normalizeBlocks(blocks)))
  const sources = { ...(existing.sources ?? {}), ...(source ? sanitizeSources({ [source.id]: source }) : {}) }
  const updated: Note = {
    ...withBlocks({ ...existing, body }),
    ...(Object.keys(sources).length ? { sources } : {}),
    updatedAt: Date.now()
  }
  cache.set(id, updated)
  await persist(updated)
  return updated
}

/** Removes every block of one capture, its metadata and its original screenshot (Undo). */
export async function removeSource(id: string, sourceId: string): Promise<Note | null> {
  const existing = cache.get(id)
  if (!existing) return null
  const blocks = (existing.blocks ?? htmlToBlocks(existing.body)).filter((b) => b.sourceId !== sourceId)
  const sources = { ...(existing.sources ?? {}) }
  const imageId = sources[sourceId]?.imageId
  delete sources[sourceId]
  const updated: Note = {
    ...existing,
    version: NOTE_FORMAT_VERSION,
    blocks,
    body: sanitizeNoteHtml(blocksToHtml(blocks)),
    sources,
    updatedAt: Date.now()
  }
  cache.set(id, updated)
  await persist(updated)
  if (imageId) await deleteNoteImage(id, imageId)
  return updated
}

export async function softDeleteNote(id: string): Promise<Note | null> {
  const existing = cache.get(id)
  if (!existing) return null
  const updated: Note = { ...existing, deletedAt: Date.now() }
  cache.set(id, updated)
  await persist(updated)
  return updated
}

export async function restoreNote(id: string): Promise<Note | null> {
  const existing = cache.get(id)
  if (!existing) return null
  const updated: Note = { ...existing, deletedAt: null, updatedAt: Date.now() }
  cache.set(id, updated)
  await persist(updated)
  return updated
}

export async function permanentlyDeleteNote(id: string): Promise<boolean> {
  if (!cache.has(id)) return false
  cache.delete(id)
  try {
    await fs.unlink(notePath(id))
  } catch {
    /* already gone */
  }
  await deleteNoteImages(id)
  return true
}

export async function emptyTrash(): Promise<void> {
  const trashed = listTrash()
  for (const note of trashed) {
    await permanentlyDeleteNote(note.id)
  }
}

export async function purgeExpiredTrash(retentionDays: number): Promise<void> {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const trashed = listTrash()
  for (const note of trashed) {
    if ((note.deletedAt ?? 0) < cutoff) {
      await permanentlyDeleteNote(note.id)
    }
  }
}

export async function togglePin(id: string): Promise<Note | null> {
  const existing = cache.get(id)
  if (!existing) return null
  return updateNote(id, { pinned: !existing.pinned })
}

export async function resetAllNotes(): Promise<void> {
  for (const id of Array.from(cache.keys())) {
    try {
      await fs.unlink(notePath(id))
    } catch {
      /* ignore */
    }
  }
  cache.clear()
  await deleteAllImages()
}

export function getNotesDirPath(): string {
  return getNotesDir()
}

/**
 * Replaces all blocks of one capture with `blocks`, at the position of the capture's first block
 * ("Привести в порядок", AI rewrite). Returns null when the note or the capture is missing.
 */
export async function replaceSourceBlocks(id: string, sourceId: string, blocks: Block[]): Promise<Note | null> {
  const existing = cache.get(id)
  if (!existing) return null
  const current = existing.blocks ?? htmlToBlocks(existing.body)
  const first = current.findIndex((b) => b.sourceId === sourceId)
  if (first === -1) return null
  const replacement = normalizeBlocks(blocks).map((b) => ({ ...b, sourceId }))
  const next = [...current.slice(0, first), ...replacement, ...current.slice(first).filter((b) => b.sourceId !== sourceId)]
  const updated: Note = {
    ...existing,
    version: NOTE_FORMAT_VERSION,
    blocks: next,
    body: sanitizeNoteHtml(blocksToHtml(next)),
    updatedAt: Date.now()
  }
  cache.set(id, updated)
  await persist(updated)
  return updated
}

/** Inserts blocks right after the last block of a capture (AI "Объяснить" / "Выделить главное"). */
export async function insertAfterSource(id: string, sourceId: string, blocks: Block[]): Promise<Note | null> {
  const existing = cache.get(id)
  if (!existing) return null
  const current = existing.blocks ?? htmlToBlocks(existing.body)
  let last = -1
  current.forEach((b, i) => {
    if (b.sourceId === sourceId) last = i
  })
  if (last === -1) return null
  const inserted = normalizeBlocks(blocks)
  const next = [...current.slice(0, last + 1), ...inserted, ...current.slice(last + 1)]
  const updated: Note = {
    ...existing,
    version: NOTE_FORMAT_VERSION,
    blocks: next,
    body: sanitizeNoteHtml(blocksToHtml(next)),
    updatedAt: Date.now()
  }
  cache.set(id, updated)
  await persist(updated)
  return updated
}
