import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { Note } from '../shared/types'
import { looksLikeHtml, plainTextToHtml } from '../shared/htmlText'
import { sanitizeNoteHtml } from './htmlSanitize'
import { deleteNoteImages, deleteAllImages } from './imageStore'

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
  await fs.writeFile(notePath(note.id), JSON.stringify(note, null, 2), 'utf-8')
}

export async function initNotesStore(): Promise<void> {
  const dir = getNotesDir()
  await fs.mkdir(dir, { recursive: true })
  const files = await fs.readdir(dir)
  cache = new Map()
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    try {
      const raw = await fs.readFile(path.join(dir, file), 'utf-8')
      const parsed = JSON.parse(raw) as Partial<Note>
      if (parsed && typeof parsed.id === 'string') {
        const note: Note = {
          id: parsed.id,
          title: parsed.title ?? '',
          body: parsed.body ?? '',
          emoji: parsed.emoji ?? null,
          pinned: parsed.pinned ?? false,
          createdAt: parsed.createdAt ?? Date.now(),
          updatedAt: parsed.updatedAt ?? Date.now(),
          deletedAt: parsed.deletedAt ?? null
        }
        if (note.body && !looksLikeHtml(note.body)) {
          note.body = plainTextToHtml(note.body)
        }
        if (JSON.stringify(note) !== JSON.stringify(parsed)) {
          await persist(note)
        }
        cache.set(note.id, note)
      }
    } catch {
      /* skip corrupt file */
    }
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
  cache.set(note.id, note)
  await persist(note)
  return note
}

export async function updateNote(id: string, patch: Partial<Note>): Promise<Note | null> {
  const existing = cache.get(id)
  if (!existing) return null
  const updated: Note = { ...existing, ...patch, id: existing.id, updatedAt: Date.now() }
  if (patch.body !== undefined) updated.body = sanitizeNoteHtml(patch.body)
  cache.set(id, updated)
  await persist(updated)
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
