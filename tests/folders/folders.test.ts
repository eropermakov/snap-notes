import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import {
  decodeDragIds,
  encodeDragIds,
  folderCounts,
  idsForDrag,
  movableIds,
  notesInFolder,
  sortFolders,
  undoMovePlan,
  validateFolderName,
  type Folder
} from '../../src/shared/folders'
import { filterNotes, sortNotes } from '../../src/shared/noteList'
import { note } from '../notes/helpers'

let userData = ''

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
  nativeImage: { createFromBuffer: () => ({ getSize: () => ({ width: 0, height: 0 }) }) }
}))

async function stores() {
  vi.resetModules()
  const notes = await import('../../src/main/notesStore')
  const folders = await import('../../src/main/foldersStore')
  await notes.initNotesStore()
  await folders.initFoldersStore()
  return { notes, folders }
}

describe('folder names', () => {
  const existing = [
    { id: 'a', name: 'Работа' },
    { id: 'b', name: 'Учёба' }
  ]
  it('trims and normalizes spaces', () => {
    expect(validateFolderName('  Мои   проекты ', existing)).toEqual({ ok: true, name: 'Мои проекты' })
  })
  it('rejects empty names and duplicates (ignoring case), but allows keeping its own name', () => {
    expect(validateFolderName('   ', existing)).toMatchObject({ ok: false })
    expect(validateFolderName('работа', existing)).toMatchObject({ ok: false })
    expect(validateFolderName('работа', existing, 'a')).toEqual({ ok: true, name: 'работа' })
  })
  it('limits the length', () => {
    const check = validateFolderName('я'.repeat(200), existing)
    expect(check.ok && check.name.length).toBe(60)
  })
})

describe('drag and drop logic', () => {
  it('dragging a selected card carries the whole selection; an unselected one only itself', () => {
    expect(idsForDrag('b', ['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
    expect(idsForDrag('z', ['a', 'b', 'c'])).toEqual(['z'])
    expect(idsForDrag('a', ['a'])).toEqual(['a'])
  })
  it('the payload survives the DOM and bad data is ignored', () => {
    expect(decodeDragIds(encodeDragIds(['a1', 'b-2']))).toEqual(['a1', 'b-2'])
    expect(decodeDragIds('not json')).toEqual([])
    expect(decodeDragIds(JSON.stringify(['ok', '../evil', 5]))).toEqual(['ok'])
  })
  it('dropping on the folder a note is already in changes nothing', () => {
    const notes = [note({ id: 'a', folderId: 'f1' }), note({ id: 'b', folderId: null }), note({ id: 'c', folderId: 'f2' })]
    expect(movableIds(notes, ['a', 'b', 'c'], 'f1')).toEqual(['b', 'c'])
    expect(movableIds(notes, ['a', 'b', 'c'], null)).toEqual(['a', 'c'])
  })
  it('remembers the old folders so Undo restores each note', () => {
    const notes = [note({ id: 'a', folderId: 'f1' }), note({ id: 'b', folderId: null })]
    expect(undoMovePlan(notes, ['a', 'b'])).toEqual([
      { id: 'a', folderId: 'f1' },
      { id: 'b', folderId: null }
    ])
  })
})

describe('folder filtering and counts', () => {
  const notes = [
    note({ id: '1', folderId: 'work', pinned: true, favorite: true, tags: ['клиенты'], updatedAt: 5 }),
    note({ id: '2', folderId: 'work', updatedAt: 4 }),
    note({ id: '3', folderId: 'study', favorite: true, updatedAt: 3 }),
    note({ id: '4', folderId: null, updatedAt: 2 }),
    note({ id: '5', folderId: 'work', deletedAt: 9, updatedAt: 1 })
  ]
  it('a folder shows only its notes', () => {
    expect(filterNotes(notes.filter((n) => !n.deletedAt), { filter: 'all', folderId: 'work' }).map((n) => n.id)).toEqual(['1', '2'])
    expect(notesInFolder(notes, 'work').map((n) => n.id)).toEqual(['1', '2']) // trashed note excluded
  })
  it('"All notes" shows everything, whatever the folder', () => {
    expect(filterNotes(notes.filter((n) => !n.deletedAt), { filter: 'all' })).toHaveLength(4)
  })
  it('favorites and pinned collections are independent of the folder', () => {
    const alive = notes.filter((n) => !n.deletedAt)
    expect(filterNotes(alive, { filter: 'favorites' }).map((n) => n.id).sort()).toEqual(['1', '3'])
    expect(filterNotes(alive, { filter: 'pinned' }).map((n) => n.id)).toEqual(['1'])
  })
  it('a note in a folder can be pinned, favorite and tagged at the same time; pinned stays on top inside the folder', () => {
    const inWork = filterNotes(notes.filter((n) => !n.deletedAt), { filter: 'all', folderId: 'work' })
    const first = sortNotes(inWork, 'modified')[0]
    expect(first).toMatchObject({ id: '1', pinned: true, favorite: true, folderId: 'work', tags: ['клиенты'] })
    expect(filterNotes(inWork, { filter: 'all', tag: 'клиенты' }).map((n) => n.id)).toEqual(['1'])
  })
  it('counts only live notes per folder', () => {
    expect(Object.fromEntries(folderCounts(notes))).toEqual({ work: 2, study: 1 })
  })
  it('folders keep creation order unless a position was set', () => {
    const f = (id: string, createdAt: number, sortOrder?: number): Folder => ({ id, name: id, createdAt, updatedAt: createdAt, ...(sortOrder !== undefined ? { sortOrder } : {}) })
    expect(sortFolders([f('c', 3), f('a', 1), f('b', 2)]).map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(sortFolders([f('a', 1), f('b', 2, 0.5)]).map((x) => x.id)).toEqual(['b', 'a'])
  })
})

describe('folders and notes on disk', () => {
  beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'snap-folders-'))
    mkdirSync(path.join(userData, 'notes'))
  })
  afterEach(() => rmSync(userData, { recursive: true, force: true }))

  it('creates, renames and persists folders; names stay unique', async () => {
    let { folders } = await stores()
    const created = await folders.createFolder('Работа')
    expect(created.ok).toBe(true)
    expect(await folders.createFolder('работа')).toMatchObject({ ok: false })
    const id = (created as { ok: true; folder: Folder }).folder.id
    expect(await folders.renameFolder(id, 'Проекты')).toMatchObject({ ok: true })
    expect(await folders.createFolder('Учёба')).toMatchObject({ ok: true })
    ;({ folders } = await stores()) // restart
    expect(folders.listFolders().map((f) => f.name)).toEqual(['Проекты', 'Учёба'])
  })

  it('a damaged folders file does not crash the start', async () => {
    writeFileSync(path.join(userData, 'folders.json'), '{ broken')
    const { folders } = await stores()
    expect(folders.listFolders()).toEqual([])
  })

  it('moves a note into a folder without touching pin / favorite / tags / colour or "last modified"', async () => {
    const { notes, folders } = await stores()
    const folder = ((await folders.createFolder('Работа')) as { ok: true; folder: Folder }).folder
    const n = await notes.createNote({ title: 'T', pinned: true, favorite: true, tags: ['клиенты'], color: 'teal', updatedAt: 1000 })
    const base = notes.getNote(n.id)!.updatedAt
    const changed = await notes.moveNotesToFolder([n.id], folder.id)
    expect(changed).toEqual([{ note: expect.objectContaining({ id: n.id, folderId: folder.id }), from: null }])
    expect(notes.getNote(n.id)).toMatchObject({ folderId: folder.id, pinned: true, favorite: true, tags: ['клиенты'], color: 'teal', updatedAt: base })
    // the same move again is a no-op
    expect(await notes.moveNotesToFolder([n.id], folder.id)).toEqual([])
  })

  it('moves several notes at once and Undo puts every note back where it was', async () => {
    const { notes, folders } = await stores()
    const a = ((await folders.createFolder('A')) as { ok: true; folder: Folder }).folder
    const b = ((await folders.createFolder('B')) as { ok: true; folder: Folder }).folder
    const n1 = await notes.createNote({ folderId: a.id })
    const n2 = await notes.createNote({})
    const n3 = await notes.createNote({ folderId: b.id })
    const plan = undoMovePlan(notes.getAllNotes(), [n1.id, n2.id, n3.id])
    const changed = await notes.moveNotesToFolder([n1.id, n2.id, n3.id], b.id)
    expect(changed.map((c) => c.note.id).sort()).toEqual([n1.id, n2.id].sort()) // n3 is already in B
    expect(notes.getNote(n1.id)!.folderId).toBe(b.id)
    for (const step of plan) await notes.moveNotesToFolder([step.id], step.folderId)
    expect([n1.id, n2.id, n3.id].map((id) => notes.getNote(id)!.folderId)).toEqual([a.id, null, b.id])
  })

  it('deleting a folder keeps its notes: they simply lose the folder', async () => {
    const { notes, folders } = await stores()
    const f = ((await folders.createFolder('Старое')) as { ok: true; folder: Folder }).folder
    const n1 = await notes.createNote({ title: 'one', folderId: f.id, pinned: true })
    const n2 = await notes.createNote({ title: 'two', folderId: f.id })
    await notes.softDeleteNote(n2.id) // a trashed note that was in the folder
    const cleared = await notes.clearFolderReferences(f.id)
    await folders.removeFolder(f.id)
    expect(cleared.map((c) => c.id).sort()).toEqual([n1.id, n2.id].sort())
    expect(notes.getNote(n1.id)).toMatchObject({ title: 'one', folderId: null, pinned: true, deletedAt: null })
    expect(notes.getNote(n2.id)).toMatchObject({ folderId: null }) // restorable later without a dangling reference
    expect(folders.listFolders()).toEqual([])
    // the note files are still there
    expect(readdirSync(path.join(userData, 'notes')).filter((x) => x.endsWith('.json'))).toHaveLength(2)
  })

  it('"delete folder and move notes to the trash" uses the trash, not a permanent delete', async () => {
    const { notes, folders } = await stores()
    const f = ((await folders.createFolder('Архив')) as { ok: true; folder: Folder }).folder
    const n1 = await notes.createNote({ folderId: f.id })
    const trashed = await notes.bulkSoftDelete(notes.noteIdsInFolder(f.id))
    await notes.clearFolderReferences(f.id)
    expect(trashed).toEqual([n1.id])
    expect(notes.listTrash().map((n) => n.id)).toEqual([n1.id])
    await notes.restoreNote(n1.id)
    expect(notes.getNote(n1.id)).toMatchObject({ deletedAt: null, folderId: null })
  })

  it('a new note can be created straight into a folder', async () => {
    const { notes, folders } = await stores()
    const f = ((await folders.createFolder('Проекты')) as { ok: true; folder: Folder }).folder
    const n = await notes.createNote({ folderId: f.id })
    expect(n.folderId).toBe(f.id)
    expect((await notes.createNote({ folderId: '../evil' as never })).folderId).toBeNull()
  })

  it('old notes (before folders) are all kept, visible in "All notes", with no folder — after a backup', async () => {
    const old = { id: 'old-1', title: 'Старая', body: '<p>текст</p>', emoji: null, pinned: true, favorite: false, color: 'blue', tags: ['x'], createdAt: 1, updatedAt: 2, deletedAt: null, version: 2, blocks: [] }
    const older = { id: 'old-2', title: 'Ещё старее', body: '<p>b</p>', emoji: null, pinned: false, createdAt: 1, updatedAt: 3, deletedAt: null }
    writeFileSync(path.join(userData, 'notes', 'old-1.json'), JSON.stringify(old))
    writeFileSync(path.join(userData, 'notes', 'old-2.json'), JSON.stringify(older))
    const { notes } = await stores()
    expect(notes.listNotes().map((n) => n.id).sort()).toEqual(['old-1', 'old-2'])
    expect(notes.getNote('old-1')).toMatchObject({ folderId: null, pinned: true, color: 'blue', tags: ['x'] })
    expect(notes.getNote('old-2')).toMatchObject({ folderId: null, favorite: false, tags: [] })
    expect(JSON.parse(readFileSync(path.join(userData, 'notes', 'old-1.json'), 'utf-8')).folderId).toBeNull()
    const backups = readdirSync(path.join(userData, 'backups'))
    expect(backups).toHaveLength(1)
    expect(JSON.parse(readFileSync(path.join(userData, 'backups', backups[0], 'old-1.json'), 'utf-8'))).toEqual(old)
    expect(existsSync(path.join(userData, 'folders.json'))).toBe(false) // no folder file is invented
  })

  it('a note pointing to a folder that no longer exists is still shown in "All notes"', async () => {
    const orphan = { id: 'o', title: 'Сирота', body: '', emoji: null, pinned: false, favorite: false, color: 'default', tags: [], folderId: 'gone', createdAt: 1, updatedAt: 1, deletedAt: null, version: 2, blocks: [] }
    writeFileSync(path.join(userData, 'notes', 'o.json'), JSON.stringify(orphan))
    const { notes, folders } = await stores()
    expect(notes.listNotes().map((n) => n.id)).toEqual(['o'])
    expect(folders.getFolder('gone')).toBeUndefined()
  })
})
