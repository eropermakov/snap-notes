import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { FakeProvider, createHarness, settle } from '../providers/fakes'
import type { Block } from '../../src/shared/blocks'

let userData = ''

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
  nativeImage: { createFromBuffer: () => ({ getSize: () => ({ width: 0, height: 0 }) }) }
}))

const FRAGMENT: Block[] = [
  { id: 'p1', sourceId: 'cap', type: 'paragraph', html: 'Распозна-<br>вание  текста ,  цена 15 000 ₽' },
  { id: 'img', sourceId: 'cap', type: 'image', src: 'snap-media://n1/pic.png' },
  { id: 'c1', sourceId: 'cap', type: 'code', code: 'x  =  0  ,' }
]

async function setup(behavior?: FakeProvider['behavior']) {
  vi.resetModules()
  const store = await import('../../src/main/notesStore')
  const actions = await import('../../src/main/noteActions')
  await store.initNotesStore()
  const note = await store.createNote({ id: 'n1', body: '<p>до</p>' })
  await store.appendBlocks(note.id, FRAGMENT, { id: 'cap', capturedAt: 1 })
  await store.appendBlocks(note.id, [{ id: 'after', type: 'paragraph', html: 'после' }])
  const gemini = new FakeProvider('gemini', false, behavior)
  const h = createHarness([gemini])
  await settle()
  return { store, actions, h, gemini }
}

describe('fragment actions (§18)', () => {
  beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'snap-actions-'))
    mkdirSync(path.join(userData, 'notes'))
  })
  afterEach(() => rmSync(userData, { recursive: true, force: true }))

  it('offline tidy: local cleanup only, code untouched, nothing sent anywhere', async () => {
    const { store, actions, h, gemini } = await setup()
    const out = await actions.tidySource(h.manager, 'n1', 'cap', true)
    expect(out.ok).toBe(true)
    expect(gemini.calls).toHaveLength(0)
    const blocks = store.getNote('n1')!.blocks!
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'image', 'code', 'paragraph'])
    expect(blocks[1]).toMatchObject({ html: 'Распознавание текста, цена 15 000 ₽' })
    expect(blocks[3]).toMatchObject({ code: 'x  =  0  ,' })
  })

  it('online tidy replaces the fragment in place and keeps its photo', async () => {
    const { store, actions, h } = await setup(async () => ({
      text: '{"blocks":[{"type":"heading","level":2,"text":"Итог"},{"type":"paragraph","text":"Цена 15 000 ₽"}]}',
      model: 'g'
    }))
    const out = await actions.tidySource(h.manager, 'n1', 'cap', false)
    expect(out).toMatchObject({ ok: true, provider: 'gemini' })
    const blocks = store.getNote('n1')!.blocks!
    expect(blocks.map((b) => [b.type, b.sourceId])).toEqual([
      ['paragraph', undefined],
      ['heading', 'cap'],
      ['paragraph', 'cap'],
      ['image', 'cap'],
      ['paragraph', undefined]
    ])
  })

  it('"Объяснить" adds after the fragment and keeps the original', async () => {
    const { store, actions, h, gemini } = await setup(async () => ({ text: '{"blocks":[{"type":"paragraph","text":"Объяснение"}]}', model: 'g' }))
    const out = await actions.runAiAction(h.manager, 'n1', 'cap', 'explain', false)
    expect(out.ok).toBe(true)
    expect(gemini.calls[0].operation).toBe('AI_REWRITE')
    const texts = store.getNote('n1')!.blocks!.map((b) => (b.type === 'paragraph' ? b.html : b.type))
    expect(texts).toEqual(['до', 'Распозна-<br>вание  текста ,  цена 15 000 ₽', 'image', 'code', 'Объяснение', 'после'])
  })

  it('replacing actions keep the fragment photo', async () => {
    const { store, actions, h } = await setup(async () => ({ text: '{"blocks":[{"type":"paragraph","text":"Короче"}]}', model: 'g' }))
    expect((await actions.runAiAction(h.manager, 'n1', 'cap', 'shorten', false)).ok).toBe(true)
    const blocks = store.getNote('n1')!.blocks!.filter((b) => b.sourceId === 'cap')
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'image'])
  })

  it('AI actions are refused offline', async () => {
    const { actions, h, gemini } = await setup()
    const out = await actions.runAiAction(h.manager, 'n1', 'cap', 'translate', true, 'English')
    expect(out.ok).toBe(false)
    expect(gemini.calls).toHaveLength(0)
  })

  it('broken JSON twice leaves the note untouched', async () => {
    const { store, actions, h, gemini } = await setup(async () => ({ text: 'Вот ваш текст, но не JSON', model: 'g' }))
    const before = store.getNote('n1')!.body
    const out = await actions.runAiAction(h.manager, 'n1', 'cap', 'rewrite', false)
    expect(out.ok).toBe(false)
    expect(gemini.calls).toHaveLength(2)
    expect(store.getNote('n1')!.body).toBe(before)
  })
})
