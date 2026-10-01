import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

let userData = ''

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
  nativeImage: { createFromBuffer: () => ({ getSize: () => ({ width: 0, height: 0 }) }) }
}))

const V1_NOTE = {
  id: 'note-1',
  title: 'Старая заметка',
  body: '<p><strong>Тариф Pro</strong></p><ul><li>100 ГБ</li></ul><table><tr><td>A</td><td>1</td></tr></table>',
  emoji: null,
  pinned: false,
  createdAt: 1,
  updatedAt: 2,
  deletedAt: null
}

async function freshStore() {
  vi.resetModules()
  return import('../../src/main/notesStore')
}

describe('notes v1 → v2 migration', () => {
  beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'snap-notes-test-'))
    mkdirSync(path.join(userData, 'notes'))
    writeFileSync(path.join(userData, 'notes', 'note-1.json'), JSON.stringify(V1_NOTE, null, 2))
    writeFileSync(path.join(userData, 'notes', 'plain.json'), JSON.stringify({ ...V1_NOTE, id: 'plain', body: 'просто текст\n\nвторой абзац' }))
    writeFileSync(path.join(userData, 'notes', 'broken.json'), '{ not json')
  })
  afterEach(() => rmSync(userData, { recursive: true, force: true }))

  it('backs up the original files before rewriting, keeps HTML, adds blocks + version', async () => {
    const store = await freshStore()
    await store.initNotesStore()

    const backups = readdirSync(path.join(userData, 'backups'))
    expect(backups).toHaveLength(1)
    const backupDir = path.join(userData, 'backups', backups[0])
    expect(readdirSync(backupDir).sort()).toEqual(['note-1.json', 'plain.json'])
    expect(JSON.parse(readFileSync(path.join(backupDir, 'note-1.json'), 'utf-8'))).toEqual(V1_NOTE)

    const saved = JSON.parse(readFileSync(path.join(userData, 'notes', 'note-1.json'), 'utf-8'))
    expect(saved.version).toBe(2)
    expect(saved.body).toBe(V1_NOTE.body) // older app versions can still open it
    expect(saved.blocks.map((b: { type: string }) => b.type)).toEqual(['paragraph', 'bullet_list', 'table'])

    // Corrupt files are never touched.
    expect(readFileSync(path.join(userData, 'notes', 'broken.json'), 'utf-8')).toBe('{ not json')
    expect(store.getNote('plain')?.blocks?.map((b) => b.type)).toEqual(['paragraph', 'paragraph'])
  })

  it('a second start does not migrate or back up again', async () => {
    let store = await freshStore()
    await store.initNotesStore()
    store = await freshStore()
    await store.initNotesStore()
    expect(readdirSync(path.join(userData, 'backups'))).toHaveLength(1)
  })

  it('editor HTML updates keep blocks in sync; renderer cannot inject sources', async () => {
    const store = await freshStore()
    await store.initNotesStore()
    const updated = await store.updateNote('note-1', {
      body: '<h2>Новый</h2><pre data-lang="js"><code>x = 0</code></pre>',
      sources: { evil: { id: 'evil', capturedAt: 1 } }
    })
    expect(updated?.blocks).toMatchObject([
      { type: 'heading', level: 2, html: 'Новый' },
      { type: 'code', code: 'x = 0', language: 'js' }
    ])
    expect(updated?.sources).toBeUndefined()
  })

  it('appendBlocks links blocks to a capture; removeSource undoes it and deletes the screenshot', async () => {
    const store = await freshStore()
    await store.initNotesStore()
    const imageDir = path.join(userData, 'images', 'note-1')
    mkdirSync(imageDir, { recursive: true })
    writeFileSync(path.join(imageDir, 'orig-1.png'), 'png')

    const after = await store.appendBlocks(
      'note-1',
      [{ id: 'nb1', type: 'paragraph', html: 'Итого 15 000 ₽', sourceId: 'cap1' }],
      { id: 'cap1', capturedAt: 5, imageId: 'orig-1', appName: 'Chrome', method: 'Gemini' }
    )
    expect(after?.body.startsWith(V1_NOTE.body)).toBe(true) // existing HTML untouched
    expect(after?.blocks?.at(-1)).toMatchObject({ id: 'nb1', sourceId: 'cap1' })
    expect(after?.sources?.cap1).toMatchObject({ appName: 'Chrome', method: 'Gemini', imageId: 'orig-1' })

    const undone = await store.removeSource('note-1', 'cap1')
    expect(undone?.blocks?.some((b) => b.sourceId === 'cap1')).toBe(false)
    expect(undone?.sources?.cap1).toBeUndefined()
    expect(existsSync(path.join(imageDir, 'orig-1.png'))).toBe(false)
  })
})
