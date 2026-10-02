import type { Note } from './types'

/**
 * Folders are plain, one-level labels: a folder never holds copies of notes, a note just points to
 * one folder (or none). Pin, favorite, colour and tags are independent of it.
 */
export interface Folder {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  /** Optional manual position; folders without it follow creation order. */
  sortOrder?: number
}

export const MAX_FOLDER_NAME = 60

export type FolderNameCheck = { ok: true; name: string } | { ok: false; error: string }

/** Trimmed, single-spaced name. */
export function cleanFolderName(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_FOLDER_NAME) : ''
}

/** A name must be non-empty and unique (ignoring case) among the other folders. */
export function validateFolderName(raw: unknown, folders: readonly Pick<Folder, 'id' | 'name'>[], exceptId?: string): FolderNameCheck {
  const name = cleanFolderName(raw)
  if (!name) return { ok: false, error: 'Введите название папки' }
  const lower = name.toLocaleLowerCase('ru')
  if (folders.some((f) => f.id !== exceptId && f.name.toLocaleLowerCase('ru') === lower)) {
    return { ok: false, error: 'Папка с таким названием уже есть' }
  }
  return { ok: true, name }
}

export function sortFolders(folders: readonly Folder[]): Folder[] {
  return [...folders].sort((a, b) => (a.sortOrder ?? a.createdAt) - (b.sortOrder ?? b.createdAt) || a.createdAt - b.createdAt)
}

/** Notes shown inside a folder (trashed notes are not). */
export function notesInFolder<T extends Pick<Note, 'folderId' | 'deletedAt'>>(notes: readonly T[], folderId: string): T[] {
  return notes.filter((n) => n.folderId === folderId && n.deletedAt === null)
}

export function folderCounts(notes: readonly Pick<Note, 'folderId' | 'deletedAt'>[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const note of notes) {
    if (note.deletedAt !== null || !note.folderId) continue
    counts.set(note.folderId, (counts.get(note.folderId) ?? 0) + 1)
  }
  return counts
}

/** What a drag of one card carries: the whole selection if the card is part of it, else just the card. */
export function idsForDrag(draggedId: string, selected: readonly string[]): string[] {
  return selected.length > 1 && selected.includes(draggedId) ? [...selected] : [draggedId]
}

export const DRAG_MIME = 'application/x-snap-notes-ids'

export function encodeDragIds(ids: readonly string[]): string {
  return JSON.stringify(ids)
}

/** Reads a drop payload defensively (it comes from the DOM). */
export function decodeDragIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(v)).slice(0, 5000) : []
  } catch {
    return []
  }
}

/** Which of the dropped notes would really change folder (dropping on the folder they are in does nothing). */
export function movableIds(notes: readonly Pick<Note, 'id' | 'folderId'>[], ids: readonly string[], target: string | null): string[] {
  const wanted = new Set(ids)
  return notes.filter((n) => wanted.has(n.id) && n.folderId !== target).map((n) => n.id)
}

/** Remembers where moved notes came from, so "Undo" can put each one back. */
export function undoMovePlan(notes: readonly Pick<Note, 'id' | 'folderId'>[], movedIds: readonly string[]): { id: string; folderId: string | null }[] {
  const moved = new Set(movedIds)
  return notes.filter((n) => moved.has(n.id)).map((n) => ({ id: n.id, folderId: n.folderId }))
}
