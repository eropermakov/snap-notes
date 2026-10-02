import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

let userData = ''

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
  nativeImage: { createFromBuffer: () => ({ getSize: () => ({ width: 0, height: 0 }) }) }
}))

async function freshStore() {
  vi.resetModules()
  return import('../../src/main/notesStore')
}

const OLD_NOTE = {
  id: 'old-1',
  title: 'Старая',
  body: '<p>текст</p>',
  emoji: null,
  pinned: true,
  createdAt: 1,
  updatedAt: 2,
  deletedAt: null,
  version: 2,
  blocks: [{ id: 'b1', type: 'paragraph', html: 'текст' }]
}

describe('notes store: migration of old notes (1.6 metadata)', () => {
  beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'snap-store-'))
    mkdirSync(path.join(userData, 'notes'))
  })
  afterEach(() => rmSync(userData, { recursive: true, force: true }))

  it('backs up first, then adds safe defaults without losing anything', async () => {
    writeFileSync(path.join(userData, 'notes', 'old-1.json'), JSON.stringify(OLD_NOTE))
    writeFileSync(path.join(userData, 'notes', 'broken.json'), '{ nope')
    const store = await freshStore()
    await store.initNotesStore()

    const backups = readdirSync(path.join(userData, 'backups'))
    expect(backups).toHaveLength(1)
    expect(JSON.parse(readFileSync(path.join(userData, 'backups', backups[0], 'old-1.json'), 'utf-8'))).toEqual(OLD_NOTE)

    const saved = JSON.parse(readFileSync(path.join(userData, 'notes', 'old-1.json'), 'utf-8'))
    expect(saved).toMatchObject({ title: 'Старая', body: '<p>text</p>'.replace('text', 'текст'), pinned: true, favorite: false, color: 'default', tags: [] })
    expect(readFileSync(path.join(userData, 'notes', 'broken.json'), 'utf-8')).toBe('{ nope')
  })

  it('does not back up or rewrite notes that are already current', async () => {
    let store = await freshStore()
    await store.initNotesStore()
    await store.createNote({ id: 'new-1', title: 'Новая', tags: ['a'] })
    store = await freshStore()
    await store.initNotesStore()
    expect(existsSync(path.join(userData, 'backups'))).toBe(false)
    expect(store.getNote('new-1')?.tags).toEqual(['a'])
  })

  it('creates new notes with defaults and normalizes tags and colour', async () => {
    const store = await freshStore()
    await store.initNotesStore()
    const note = await store.createNote({ tags: ['#Работа', 'работа'], color: 'nonsense' as never })
    expect(note).toMatchObject({ pinned: false, favorite: false, color: 'default', tags: ['работа'] })
  })
})

describe('notes store: actions', () => {
  beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'snap-store-'))
    mkdirSync(path.join(userData, 'notes'))
  })
  afterEach(() => rmSync(userData, { recursive: true, force: true }))

  it('duplicates a note completely with its own id, dates and image files', async () => {
    const store = await freshStore()
    await store.initNotesStore()
    const original = await store.createNote({
      id: 'orig',
      title: 'Отчёт',
      body: '<table><tr><td>1</td></tr></table><pre><code>x = 1</code></pre><p><img class="doc-image" src="snap-media://orig/pic1.png"></p>',
      tags: ['работа'],
      color: 'teal',
      pinned: true,
      favorite: true,
      createdAt: 10,
      updatedAt: 10
    })
    mkdirSync(path.join(userData, 'images', 'orig'), { recursive: true })
    writeFileSync(path.join(userData, 'images', 'orig', 'pic1.png'), 'PIC')
    writeFileSync(path.join(userData, 'images', 'orig', 'shot.png'), 'SHOT')
    await store.appendBlocks('orig', [{ id: 'o1', sourceId: 'cap', type: 'paragraph', html: 'OCR' }], { id: 'cap', capturedAt: 5, imageId: 'shot', method: 'Gemini' })

    const copy = await store.duplicateNote('orig')
    expect(copy).not.toBeNull()
    expect(copy!.id).not.toBe(original.id)
    expect(copy!.title).toBe('Отчёт — копия')
    expect(copy).toMatchObject({ tags: ['работа'], color: 'teal', pinned: false, favorite: false })
    expect(copy!.createdAt).toBeGreaterThan(10)
    expect(copy!.blocks?.map((b) => b.type)).toEqual(['table', 'code', 'image', 'paragraph'])
    expect(copy!.sources?.cap).toMatchObject({ method: 'Gemini' })

    // The copy owns its images: references point to the new note and the files exist.
    const refs = [...copy!.body.matchAll(/snap-media:\/\/([\w-]+)\/([\w-]+)\.png/g)]
    expect(refs.length).toBe(1)
    expect(refs[0][1]).toBe(copy!.id)
    expect(readFileSync(path.join(userData, 'images', copy!.id, `${refs[0][2]}.png`), 'utf-8')).toBe('PIC')
    expect(copy!.sources!.cap.imageId).not.toBe('shot')
    expect(readFileSync(path.join(userData, 'images', copy!.id, `${copy!.sources!.cap.imageId}.png`), 'utf-8')).toBe('SHOT')
    // The original is untouched.
    expect(store.getNote('orig')!.body).toContain('snap-media://orig/pic1.png')
    expect(store.getNote('orig')).toMatchObject({ pinned: true, favorite: true })
  })

  it('applies bulk changes and sends several notes to the trash, restorable', async () => {
    const store = await freshStore()
    await store.initNotesStore()
    const a = await store.createNote({ title: 'a' })
    const b = await store.createNote({ title: 'b' })
    const c = await store.createNote({ title: 'c' })

    await store.bulkUpdate([a.id, b.id], { type: 'pin', value: true })
    await store.bulkUpdate([a.id, b.id], { type: 'favorite', value: true })
    await store.bulkUpdate([a.id, b.id, c.id], { type: 'addTags', tags: ['#Важно', 'идеи'] })
    await store.bulkUpdate([b.id], { type: 'removeTags', tags: ['идеи'] })
    await store.bulkUpdate([c.id], { type: 'color', value: 'purple' })
    expect(store.getNote(a.id)).toMatchObject({ pinned: true, favorite: true, tags: ['важно', 'идеи'] })
    expect(store.getNote(b.id)?.tags).toEqual(['важно'])
    expect(store.getNote(c.id)).toMatchObject({ pinned: false, color: 'purple' })

    const moved = await store.bulkSoftDelete([a.id, b.id, 'missing'])
    expect(moved).toEqual([a.id, b.id])
    expect(store.listNotes().map((n) => n.id)).toEqual([c.id])
    expect(store.listTrash().map((n) => n.id).sort()).toEqual([a.id, b.id].sort())
    // Nothing was destroyed: undo restores the notes with their data.
    await store.restoreNote(a.id)
    expect(store.getNote(a.id)).toMatchObject({ deletedAt: null, tags: ['важно', 'идеи'] })
  })

  it('removes an auto-created note that stayed empty, never one the user made or used', async () => {
    const store = await freshStore()
    await store.initNotesStore()
    const auto = await store.createNote({ autoCreated: true })
    const manual = await store.createNote({})
    const typed = await store.createNote({ autoCreated: true })
    await store.updateNote(typed.id, { body: '<p>привет</p>' }, { user: true })

    expect(await store.discardIfEmptyAuto(auto.id)).toBe(true)
    expect(store.getNote(auto.id)).toBeUndefined()
    expect(await store.discardIfEmptyAuto(manual.id)).toBe(false)
    expect(await store.discardIfEmptyAuto(typed.id)).toBe(false)
    expect(store.getNote(typed.id)?.autoCreated).toBeUndefined()
  })

  it('OCR undo on a note made by the capture removes the content and then the empty note', async () => {
    const store = await freshStore()
    await store.initNotesStore()
    const note = await store.createNote({ autoCreated: true })
    await store.appendBlocks(note.id, [{ id: 'p', sourceId: 'cap', type: 'paragraph', html: 'Распознано' }], { id: 'cap', capturedAt: 1 })
    await store.setAutoTitle(note.id, 'Распознано') // the app's own title does not make the note "used"
    expect(await store.discardIfEmptyAuto(note.id)).toBe(false) // has a capture: stays
    await store.removeSource(note.id, 'cap')
    expect(store.getNote(note.id)?.body).toBe('')
    expect(await store.discardIfEmptyAuto(note.id)).toBe(true)
  })

  it('sweeps forgotten empty auto-created notes at start', async () => {
    let store = await freshStore()
    await store.initNotesStore()
    const auto = await store.createNote({ autoCreated: true })
    const keep = await store.createNote({})
    store = await freshStore()
    await store.initNotesStore()
    expect(store.getNote(auto.id)).toBeUndefined()
    expect(store.getNote(keep.id)).toBeDefined()
  })

  it('a title the user typed is never replaced automatically; an auto title is', async () => {
    const store = await freshStore()
    await store.initNotesStore()
    const auto = await store.createNote({ autoCreated: true })
    expect((await store.setAutoTitle(auto.id, 'Из текста'))?.title).toBe('Из текста')
    // the user renames it: from now on it is theirs
    await store.updateNote(auto.id, { title: 'Моё название' }, { user: true })
    expect(store.getNote(auto.id)).toMatchObject({ title: 'Моё название', titleManual: true })
    expect((await store.setAutoTitle(auto.id, 'Другое'))?.title).toBe('Моё название')
    // an empty note without a title that the user cleared again gets automatic titles again
    await store.updateNote(auto.id, { title: '' }, { user: true })
    expect(store.getNote(auto.id)?.titleManual).toBeUndefined()
  })

  it('pin, favorite and colour do not change "last modified"; editing does', async () => {
    const store = await freshStore()
    await store.initNotesStore()
    const note = await store.createNote({ title: 'x', updatedAt: 1000 })
    await store.updateNote(note.id, { updatedAt: 1000 } as never)
    const base = store.getNote(note.id)!.updatedAt
    await new Promise((r) => setTimeout(r, 5))
    await store.updateNote(note.id, { pinned: true, favorite: true, color: 'blue' })
    expect(store.getNote(note.id)!.updatedAt).toBe(base)
    await new Promise((r) => setTimeout(r, 5))
    await store.updateNote(note.id, { body: '<p>текст</p>' }, { user: true })
    expect(store.getNote(note.id)!.updatedAt).toBeGreaterThan(base)
  })

  it('the renderer can not change protected fields through an update', async () => {
    const store = await freshStore()
    await store.initNotesStore()
    const note = await store.createNote({ id: 'prot', title: 'x' })
    const updated = await store.updateNote('prot', { id: 'evil', deletedAt: 5, createdAt: 99, color: 'teal' } as never)
    expect(updated).toMatchObject({ id: 'prot', deletedAt: null, createdAt: note.createdAt, color: 'teal' })
  })
})
