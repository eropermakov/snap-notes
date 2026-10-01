import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Note } from '../../src/shared/types'
import type { HudState } from '../../src/shared/hud'

// ---- in-memory doubles for everything the pipeline touches -----------------------------------
const notes = new Map<string, Note>()
let nextId = 1
const hudStates: HudState[] = []
const overlayModes: unknown[] = []
let screenshotResult: Buffer | null = Buffer.from('png')
let pickChoice: string | null = 'new'
let captureNoNote: 'new' | 'ask' = 'new'

const note = (id: string, title = ''): Note => ({
  id,
  title,
  body: '',
  emoji: null,
  pinned: false,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  blocks: []
})

vi.mock('electron', () => ({ BrowserWindow: class {}, ipcMain: { on: vi.fn() } }))
vi.mock('../../src/main/notesStore', () => ({
  getNote: (id: string) => notes.get(id),
  listNotes: () => Array.from(notes.values()),
  createNote: async () => {
    const n = note(`n${nextId++}`)
    notes.set(n.id, n)
    return n
  },
  appendBlocks: async (id: string, blocks: { id: string; html?: string; sourceId?: string }[]) => {
    const n = notes.get(id)!
    const updated = { ...n, blocks: [...(n.blocks ?? []), ...(blocks as never[])] }
    notes.set(id, updated)
    return updated
  },
  removeSource: async (id: string, sourceId: string) => {
    const n = notes.get(id)!
    const updated = { ...n, blocks: (n.blocks ?? []).filter((b) => b.sourceId !== sourceId) }
    notes.set(id, updated)
    return updated
  }
}))
vi.mock('../../src/main/settingsStore', () => ({
  getSettings: () => ({ screenshotCacheEnabled: false, captureNoNote })
}))
vi.mock('../../src/main/screenshot', () => ({
  captureRegionAtCursor: async (_p: string, mode: unknown) => {
    overlayModes.push(mode)
    return screenshotResult
  },
  captureFullscreenAtCursor: async () => screenshotResult
}))
let captureCounter = 0
vi.mock('../../src/main/captureContent', () => ({
  recognizeCapture: async () => {
    const sourceId = `src${++captureCounter}`
    return {
      blocks: [{ id: `b${captureCounter}`, sourceId, type: 'paragraph', html: `Фрагмент ${captureCounter}.` }],
      source: { id: sourceId, capturedAt: 1 },
      output: { notice: null, offlineFallback: false }
    }
  },
  discardCapture: async () => {}
}))
vi.mock('../../src/main/windowInfo', () => ({ readForegroundWindow: async () => ({}) }))
vi.mock('../../src/main/screenshotCache', () => ({ saveToCache: async () => {} }))
vi.mock('../../src/main/logger', () => ({ logEvent: () => {} }))
vi.mock('../../src/main/hud', () => ({
  show: (state: HudState) => hudStates.push(state),
  setSession: () => {},
  pickNote: async () => pickChoice
}))

async function load() {
  vi.resetModules()
  const pipeline = await import('../../src/main/capturePipeline')
  pipeline.initCapturePipeline(() => null, {} as never)
  return pipeline
}

const lastHud = (): HudState => hudStates[hudStates.length - 1]

describe('Capture Session (§13) and capture targets (§1)', () => {
  beforeEach(() => {
    notes.clear()
    nextId = 1
    captureCounter = 0
    hudStates.length = 0
    overlayModes.length = 0
    screenshotResult = Buffer.from('png')
    pickChoice = 'new'
    captureNoNote = 'new'
  })

  it('session: first capture on start, next ones go to the same note in order, then finish', async () => {
    const p = await load()
    await p.toggleCaptureSession('preload')
    expect(p.isCaptureSessionActive()).toBe(true)
    const [sessionNote] = Array.from(notes.values())
    expect(lastHud()).toMatchObject({ kind: 'added', noteId: sessionNote.id, session: { count: 1 } })

    // Another note gets "opened" meanwhile: the session still collects into its own note.
    notes.set('other', note('other', 'Другая'))
    p.setActiveNoteId('other')
    await p.runCapture('region', 'preload')
    expect(overlayModes.at(-1)).toEqual({ session: { count: 1 } })
    expect(notes.get(sessionNote.id)!.blocks!.map((b) => (b as { html: string }).html)).toEqual(['Фрагмент 1.', 'Фрагмент 2.'])
    expect(notes.get('other')!.blocks).toEqual([])

    p.finishCaptureSession()
    expect(p.isCaptureSessionActive()).toBe(false)
    expect(lastHud()).toMatchObject({ kind: 'added', detail: 'Сессия завершена · фрагментов: 2' })
  })

  it('session hotkey pressed again finishes the session', async () => {
    const p = await load()
    await p.toggleCaptureSession('preload')
    await p.toggleCaptureSession('preload')
    expect(p.isCaptureSessionActive()).toBe(false)
  })

  it('cancelling the selection during a session returns the HUD to the session counter', async () => {
    const p = await load()
    await p.toggleCaptureSession('preload')
    screenshotResult = null
    await p.runCapture('region', 'preload')
    expect(lastHud()).toMatchObject({ kind: 'session', session: { count: 1 } })
  })

  it('undo removes the capture and decrements the session counter', async () => {
    const p = await load()
    await p.toggleCaptureSession('preload')
    const [n] = Array.from(notes.values())
    await p.undoCapture(n.id, 'src1')
    expect(notes.get(n.id)!.blocks).toEqual([])
    expect(lastHud()).toMatchObject({ kind: 'message', text: 'Добавление отменено', session: { count: 0 } })
  })

  it('capture goes to the open note; without one a new note is created by default', async () => {
    const p = await load()
    await p.runCapture('region', 'preload')
    expect(notes.size).toBe(1)
    const [created] = Array.from(notes.values())
    expect(lastHud()).toMatchObject({ kind: 'added', noteId: created.id, sourceId: 'src1' })

    notes.set('open', note('open', 'Открытая'))
    p.setActiveNoteId('open')
    await p.runCapture('region', 'preload')
    expect(notes.get('open')!.blocks).toHaveLength(1)
  })

  it('"ask" mode: the HUD picker chooses the note; cancel adds nothing', async () => {
    captureNoNote = 'ask'
    notes.set('recent', note('recent', 'Недавняя'))
    const p = await load()
    pickChoice = 'recent'
    await p.runCapture('region', 'preload')
    expect(notes.get('recent')!.blocks).toHaveLength(1)

    p.setActiveNoteId(null)
    pickChoice = null
    await p.runCapture('region', 'preload')
    expect(notes.size).toBe(1)
    expect(notes.get('recent')!.blocks).toHaveLength(1)
  })
})
