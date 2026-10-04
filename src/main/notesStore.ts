import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { Note } from '../shared/types'
import { addTags, isContentPatch, normalizeFolderId, normalizeColor, normalizeTags, needsMetaMigration, readNoteMeta, removeTags, type NoteColor } from '../shared/noteMeta'
import { isDiscardableAutoNote } from '../shared/noteLifecycle'
import { collectImageIds, rewriteImageRefs } from '../shared/imageRefs'
import { looksLikeHtml, plainTextToHtml } from '../shared/htmlText'
import { NOTE_FORMAT_VERSION, blocksToHtml, htmlToBlocks, normalizeBlocks, type Block, type OcrSource } from '../shared/blocks'
import { sanitizeNoteHtml } from './htmlSanitize'
import { deleteNoteImages, deleteAllImages, deleteNoteImage, copyNoteImages, saveDocumentImage, imageSrc } from './imageStore'
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
      ...(str(s.mode, 40) ? { mode: str(s.mode, 40) } : {}),
      ...(s.quality === 'HIGH' || s.quality === 'MEDIUM' || s.quality === 'LOW' ? { quality: s.quality } : {}),
      ...(str(s.jobId, 64) && /^[a-zA-Z0-9_-]+$/.test(str(s.jobId, 64) as string) ? { jobId: str(s.jobId, 64) } : {}),
      ...(s.failed === true ? { failed: true } : {})
    }
    result[key] = source
  }
  return result
}

/**
 * Copies the given note files, unchanged, into userData/backups/notes-pre-migration-<timestamp>/
 * before they are first rewritten (format v1 -> v2, or metadata added in 1.6). Returns false if the
 * copy could not be completed.
 */
async function backupBeforeMigration(dir: string, files: string[]): Promise<boolean> {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupDir = path.join(app.getPath('userData'), 'backups', `notes-pre-migration-${stamp}`)
    await fs.mkdir(backupDir, { recursive: true })
    for (const file of files) await fs.copyFile(path.join(dir, file), path.join(backupDir, file))
    const copied = (await fs.readdir(backupDir)).length
    logEvent('notes', { migration: 'notes', notes: files.length, backup: path.basename(backupDir), copied })
    return copied === files.length
  } catch (err) {
    logEvent('notes', { migration: 'notes', backupFailed: err instanceof Error ? err.name : 'unknown' })
    return false
  }
}

export async function initNotesStore(pendingCaptureNotes: ReadonlySet<string> = new Set()): Promise<void> {
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

  // v1 -> v2 and the 1.6 metadata (favorite / colour / tags): back up the originals first. If the
  // backup fails, notes are converted in memory only and the files on disk stay exactly as they were
  // (the next edit of a note saves it in the new format).
  const outdated = loaded.filter((l) => l.parsed.version !== NOTE_FORMAT_VERSION || needsMetaMigration(l.parsed as Record<string, unknown>))
  const mayRewrite = outdated.length === 0 || (await backupBeforeMigration(dir, outdated.map((l) => l.file)))

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
        ...readNoteMetaFields(parsed),
        createdAt: parsed.createdAt ?? Date.now(),
        updatedAt: parsed.updatedAt ?? Date.now(),
        deletedAt: parsed.deletedAt ?? null
      }),
      ...(Object.keys(sources).length ? { sources } : {})
    }
    const isOutdated = parsed.version !== NOTE_FORMAT_VERSION || needsMetaMigration(parsed as Record<string, unknown>)
    if ((!isOutdated || mayRewrite) && JSON.stringify(note) !== JSON.stringify(parsed)) {
      await persist(note)
    }
    cache.set(note.id, note)
  }
  await sweepEmptyAutoNotes(pendingCaptureNotes)
}

function readNoteMetaFields(parsed: Partial<Note>): Pick<Note, 'folderId' | 'favorite' | 'color' | 'tags' | 'autoCreated' | 'titleManual'> {
  const meta = readNoteMeta(parsed as Record<string, unknown>)
  return {
    folderId: meta.folderId,
    favorite: meta.favorite,
    color: meta.color,
    tags: meta.tags,
    ...(meta.autoCreated ? { autoCreated: true } : {}),
    ...(meta.titleManual ? { titleManual: true } : {})
  }
}

/** Auto-created notes that were never filled (e.g. the app closed during a capture) are removed. */
async function sweepEmptyAutoNotes(pendingCaptureNotes: ReadonlySet<string>): Promise<void> {
  for (const note of Array.from(cache.values())) {
    if (!pendingCaptureNotes.has(note.id) && isDiscardableAutoNote(note)) await permanentlyDeleteNote(note.id)
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

export function getAllNotes(): Note[] {
  return Array.from(cache.values())
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
    folderId: null,
    favorite: false,
    color: 'default',
    tags: [],
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...partial
  }
  note.color = normalizeColor(note.color)
  note.tags = normalizeTags(note.tags)
  note.folderId = normalizeFolderId(note.folderId)
  if (note.body) note.body = sanitizeNoteHtml(note.body)
  const stored = withBlocks(note)
  cache.set(stored.id, stored)
  await persist(stored)
  return stored
}

export interface UpdateOptions {
  /** The patch comes from the user's editing (not from the app): affects auto-created / manual-title flags. */
  user?: boolean
}

export async function updateNote(id: string, patch: Partial<Note>, options: UpdateOptions = {}): Promise<Note | null> {
  const existing = cache.get(id)
  if (!existing) return null
  // Sources are only changed by appendBlocks/removeSource (main process), never by a renderer patch.
  const { blocks: patchBlocks, sources: _sources, version: _version, id: _id, createdAt: _created, deletedAt: _deleted, ...rest } = patch
  let updated: Note = { ...existing, ...rest, id: existing.id, updatedAt: isContentPatch(patch) ? Date.now() : existing.updatedAt }
  if (rest.color !== undefined) updated.color = normalizeColor(rest.color)
  if (rest.tags !== undefined) updated.tags = normalizeTags(rest.tags)
  if (rest.favorite !== undefined) updated.favorite = rest.favorite === true
  if (rest.folderId !== undefined) updated.folderId = normalizeFolderId(rest.folderId)
  if (rest.pinned !== undefined) updated.pinned = rest.pinned === true
  if (typeof rest.title === 'string') updated.title = rest.title.slice(0, 500)
  if (patchBlocks !== undefined) {
    // Blocks are the source of truth for this change: the editor HTML is rendered from them.
    const blocks = normalizeBlocks(patchBlocks)
    updated = { ...updated, version: NOTE_FORMAT_VERSION, blocks, body: sanitizeNoteHtml(blocksToHtml(blocks)) }
  } else if (patch.body !== undefined) {
    updated = withBlocks({ ...updated, body: sanitizeNoteHtml(patch.body) })
  }
  if (options.user) {
    // The user is working in this note: it is no longer a disposable auto-created one, and a title
    // they typed is theirs for good.
    if (updated.body !== existing.body || updated.title !== existing.title) delete updated.autoCreated
    if (updated.title !== existing.title) {
      if (updated.title.trim()) updated.titleManual = true
      else delete updated.titleManual
    }
  }
  cache.set(id, updated)
  await persist(updated)
  return updated
}

/** Local automatic title (first meaningful line). Never overrides a title the user typed. */
export async function setAutoTitle(id: string, title: string): Promise<Note | null> {
  const existing = cache.get(id)
  if (!existing || existing.titleManual || existing.title.trim() || !title.trim()) return existing ?? null
  return updateNote(id, { title })
}

export type BulkOp =
  | { type: 'pin'; value: boolean }
  | { type: 'favorite'; value: boolean }
  | { type: 'color'; value: NoteColor }
  | { type: 'addTags'; tags: string[] }
  | { type: 'removeTags'; tags: string[] }

/** One change applied to several notes. Missing / trashed notes are skipped. */
export async function bulkUpdate(ids: string[], op: BulkOp): Promise<Note[]> {
  const result: Note[] = []
  for (const id of ids) {
    const note = cache.get(id)
    if (!note || note.deletedAt !== null) continue
    const patch: Partial<Note> =
      op.type === 'pin'
        ? { pinned: op.value }
        : op.type === 'favorite'
          ? { favorite: op.value }
          : op.type === 'color'
            ? { color: normalizeColor(op.value) }
            : op.type === 'addTags'
              ? { tags: addTags(note.tags, op.tags) }
              : { tags: removeTags(note.tags, op.tags) }
    const updated = await updateNote(id, patch)
    if (updated) result.push(updated)
  }
  return result
}

/** Moves several notes to the trash (never a permanent delete). Returns the ids actually moved. */
export async function bulkSoftDelete(ids: string[]): Promise<string[]> {
  const moved: string[] = []
  for (const id of ids) {
    const note = cache.get(id)
    if (!note || note.deletedAt !== null) continue
    await softDeleteNote(id)
    moved.push(id)
  }
  return moved
}

/**
 * Full copy of a note with its own id and dates: content, tables, code, OCR blocks and fragment
 * metadata, tags and colour, and its own copies of the image files. Pinned / favorite start off.
 */
export async function duplicateNote(id: string): Promise<Note | null> {
  const source = cache.get(id)
  if (!source) return null
  const newId = randomUUID()
  const imageIds = new Set(collectImageIds(source.body, source.id))
  for (const src of Object.values(source.sources ?? {})) if (src.imageId) imageIds.add(src.imageId)
  const idMap = await copyNoteImages(source.id, newId, [...imageIds])
  const sources: Record<string, OcrSource> = {}
  for (const [key, value] of Object.entries(source.sources ?? {})) {
    sources[key] = { ...value, ...(value.imageId && idMap.has(value.imageId) ? { imageId: idMap.get(value.imageId) } : {}) }
  }
  const now = Date.now()
  const body = rewriteImageRefs(source.body, source.id, newId, idMap)
  const title = source.title.trim() ? `${source.title.trim()} — копия` : ''
  const copy: Note = {
    ...withBlocks({
      id: newId,
      title,
      body,
      emoji: source.emoji,
      pinned: false,
      folderId: source.folderId,
      favorite: false,
      color: source.color,
      tags: [...source.tags],
      createdAt: now,
      updatedAt: now,
      deletedAt: null
    }),
    ...(title ? { titleManual: true } : {}),
    ...(Object.keys(sources).length ? { sources } : {})
  }
  cache.set(copy.id, copy)
  await persist(copy)
  return copy
}

/**
 * Moves notes into a folder (null = out of every folder). Returns the notes that really changed,
 * with the folder each one came from, so the move can be undone. A move is organisation, not
 * editing: it does not touch "last modified".
 */
export async function moveNotesToFolder(ids: string[], folderId: string | null): Promise<{ note: Note; from: string | null }[]> {
  const target = normalizeFolderId(folderId)
  const changed: { note: Note; from: string | null }[] = []
  for (const id of ids) {
    const existing = cache.get(id)
    if (!existing || existing.folderId === target) continue
    const updated = await updateNote(id, { folderId: target })
    if (updated) changed.push({ note: updated, from: existing.folderId })
  }
  return changed
}

/** A folder was deleted: every note that pointed to it (also in the trash) is simply "without a folder". */
export async function clearFolderReferences(folderId: string): Promise<Note[]> {
  const cleared: Note[] = []
  for (const note of Array.from(cache.values())) {
    if (note.folderId !== folderId) continue
    const updated: Note = { ...note, folderId: null }
    cache.set(note.id, updated)
    await persist(updated)
    cleared.push(updated)
  }
  return cleared
}

export function noteIdsInFolder(folderId: string): string[] {
  return Array.from(cache.values()).filter((n) => n.folderId === folderId && n.deletedAt === null).map((n) => n.id)
}

/** Removes an auto-created note that is still empty (nothing typed, no captures, no images). */
export async function discardIfEmptyAuto(id: string): Promise<boolean> {
  const note = cache.get(id)
  if (!note || !isDiscardableAutoNote(note)) return false
  return permanentlyDeleteNote(id)
}

/** Stores a picture dropped into a note and returns the snap-media:// address to show it. */
export async function addNoteImage(noteId: string, png: Buffer): Promise<string | null> {
  if (!cache.has(noteId)) return null
  const imageId = await saveDocumentImage(noteId, png)
  return imageSrc(noteId, imageId)
}

/**
 * Inserts recognized blocks right after the image block showing `imageSrcUrl` ("Recognize text"),
 * or in place of it when `replace` is set. Returns null when the note or the image is not found.
 */
export async function insertAfterImage(
  id: string,
  imageSrcUrl: string,
  blocks: Block[],
  source: OcrSource | undefined,
  replace: boolean
): Promise<Note | null> {
  const existing = cache.get(id)
  if (!existing) return null
  const current = existing.blocks ?? htmlToBlocks(existing.body)
  const index = current.findIndex((b) => b.type === 'image' && b.src === imageSrcUrl)
  if (index === -1) return null
  const inserted = normalizeBlocks(blocks)
  const next = [...current.slice(0, replace ? index : index + 1), ...inserted, ...current.slice(index + 1)]
  const sources = { ...(existing.sources ?? {}), ...(source ? sanitizeSources({ [source.id]: source }) : {}) }
  const updated: Note = {
    ...existing,
    version: NOTE_FORMAT_VERSION,
    blocks: next,
    body: sanitizeNoteHtml(blocksToHtml(next)),
    ...(Object.keys(sources).length ? { sources } : {}),
    updatedAt: Date.now()
  }
  cache.set(id, updated)
  await persist(updated)
  return updated
}

/** Replaces the metadata of one capture (a retried capture no longer has the "failed" mark). */
export async function putSource(id: string, source: OcrSource): Promise<Note | null> {
  const existing = cache.get(id)
  if (!existing) return null
  const sources = { ...(existing.sources ?? {}), ...sanitizeSources({ [source.id]: source }) }
  const updated: Note = { ...existing, sources, updatedAt: Date.now() }
  cache.set(id, updated)
  await persist(updated)
  return updated
}

/** Updates the recorded recognizer of a fragment (after "Retry with another AI"). */
export async function updateSource(id: string, sourceId: string, patch: Partial<OcrSource>): Promise<Note | null> {
  const existing = cache.get(id)
  const current = existing?.sources?.[sourceId]
  if (!existing || !current) return null
  const sources = { ...(existing.sources ?? {}), ...sanitizeSources({ [sourceId]: { ...current, ...patch, id: sourceId } }) }
  const updated: Note = { ...existing, sources, updatedAt: Date.now() }
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
