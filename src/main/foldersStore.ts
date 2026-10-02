import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { cleanFolderName, sortFolders, validateFolderName, type Folder } from '../shared/folders'

/**
 * Folders live in one small file (`userData/folders.json`), next to the notes folder. Notes keep only
 * a `folderId`; removing a folder never touches note files except to clear that reference.
 */
let cache: Folder[] = []
let file: string | null = null

function filePath(): string {
  if (!file) file = path.join(app.getPath('userData'), 'folders.json')
  return file
}

async function persist(): Promise<void> {
  const target = filePath()
  const temp = `${target}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temp, JSON.stringify({ version: 1, folders: cache }, null, 2), 'utf-8')
    await fs.rename(temp, target)
  } finally {
    await fs.rm(temp, { force: true }).catch(() => undefined)
  }
}

const SAFE_ID = /^[a-zA-Z0-9_-]{1,64}$/

export async function initFoldersStore(): Promise<void> {
  cache = []
  try {
    const parsed = JSON.parse(await fs.readFile(filePath(), 'utf-8')) as { folders?: unknown }
    const raw = Array.isArray(parsed.folders) ? parsed.folders : []
    const seen = new Set<string>()
    for (const item of raw) {
      const f = item as Partial<Folder>
      const name = cleanFolderName(f?.name)
      if (!f || typeof f.id !== 'string' || !SAFE_ID.test(f.id) || !name || seen.has(f.id)) continue
      seen.add(f.id)
      cache.push({
        id: f.id,
        name,
        createdAt: typeof f.createdAt === 'number' ? f.createdAt : Date.now(),
        updatedAt: typeof f.updatedAt === 'number' ? f.updatedAt : Date.now(),
        ...(typeof f.sortOrder === 'number' && Number.isFinite(f.sortOrder) ? { sortOrder: f.sortOrder } : {})
      })
    }
  } catch {
    /* no folders yet (or an unreadable file: it is left untouched until the next change) */
  }
}

export function listFolders(): Folder[] {
  return sortFolders(cache)
}

export function getFolder(id: string | null): Folder | undefined {
  return id ? cache.find((f) => f.id === id) : undefined
}

export type FolderResult = { ok: true; folder: Folder } | { ok: false; error: string }

export async function createFolder(rawName: unknown): Promise<FolderResult> {
  const check = validateFolderName(rawName, cache)
  if (!check.ok) return check
  const now = Date.now()
  const folder: Folder = { id: randomUUID(), name: check.name, createdAt: now, updatedAt: now }
  cache.push(folder)
  await persist()
  return { ok: true, folder }
}

export async function renameFolder(id: string, rawName: unknown): Promise<FolderResult> {
  const folder = cache.find((f) => f.id === id)
  if (!folder) return { ok: false, error: 'Папка не найдена' }
  const check = validateFolderName(rawName, cache, id)
  if (!check.ok) return check
  folder.name = check.name
  folder.updatedAt = Date.now()
  await persist()
  return { ok: true, folder }
}

export async function removeFolder(id: string): Promise<boolean> {
  const before = cache.length
  cache = cache.filter((f) => f.id !== id)
  if (cache.length === before) return false
  await persist()
  return true
}

export async function resetFolders(): Promise<void> {
  cache = []
  await fs.rm(filePath(), { force: true }).catch(() => undefined)
}
