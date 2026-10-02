import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import type { Note } from '../../src/shared/types'
import type { HudState } from '../../src/shared/hud'

// ---- in-memory doubles for everything the pipeline touches (the OCR queue itself is real) -----
const notes = new Map<string, Note>()
let userData = ''
let nextId = 1
const hudStates: HudState[] = []
const overlayModes: unknown[] = []
let screenshotResult: Buffer | null = Buffer.from('png')
let repeatResult: { ok: true; buffer: Buffer } | { ok: false; reason: string } = { ok: true, buffer: Buffer.from('repeat') }
let lastRegion: unknown = { displayId: 1 }
let pickChoice: string | null = 'new'
let captureNoNote: 'new' | 'ask' = 'new'
/** Recognition of capture #n waits for this gate (simulates a slow AI). */
let recognizeDelay: (n: number) => Promise<void> = async () => undefined
let recognizeFailures = new Set<number>()
let recognizeCalls: number[] = []

const note = (id: string, title = ''): Note => ({
  id,
  title,
  body: '',
  emoji: null,
  pinned: false,
  folderId: null,
  favorite: false,
  color: 'default',
  tags: [],
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  blocks: []
})

vi.mock('electron', () => ({ BrowserWindow: class {}, ipcMain: { on: vi.fn() }, app: { getPath: () => userData } }))
vi.mock('../../src/main/notesStore', () => ({
  getNote: (id: string) => notes.get(id),
  listNotes: () => Array.from(notes.values()),
  createNote: async (partial?: Partial<Note>) => {
    const n = { ...note(`n${nextId++}`), ...partial }
    notes.set(n.id, n)
    return n
  },
  appendBlocks: async (id: string, blocks: { id: string; html?: string; sourceId?: string }[]) => {
    const n = notes.get(id)
    if (!n) return null
    const updated = { ...n, blocks: [...(n.blocks ?? []), ...(blocks as never[])] }
    notes.set(id, updated)
    return updated
  },
  replaceSourceBlocks: async (id: string, sourceId: string, blocks: unknown[]) => {
    const n = notes.get(id)!
    const first = (n.blocks ?? []).findIndex((b) => b.sourceId === sourceId)
    const rest = (n.blocks ?? []).filter((b) => b.sourceId !== sourceId)
    rest.splice(first, 0, ...(blocks as never[]))
    const updated = { ...n, blocks: rest }
    notes.set(id, updated)
    return updated
  },
  putSource: async (id: string) => notes.get(id),
  setAutoTitle: async (id: string, title: string) => {
    const n = notes.get(id)!
    const updated = { ...n, title: n.title || title }
    notes.set(id, updated)
    return updated
  },
  discardIfEmptyAuto: async (id: string) => {
    const n = notes.get(id)
    if (n && n.autoCreated && !(n.blocks ?? []).length) {
      notes.delete(id)
      return true
    }
    return false
  },
  removeSource: async (id: string, sourceId: string) => {
    const n = notes.get(id)!
    const updated = { ...n, blocks: (n.blocks ?? []).filter((b) => b.sourceId !== sourceId) }
    notes.set(id, updated)
    return updated
  }
}))
vi.mock('../../src/main/settingsStore', () => ({
  getSettings: () => ({
    screenshotCacheEnabled: false,
    captureNoNote,
    ocrQueueEnabled: true,
    ocrMaxConcurrent: 1,
    ocrFeedback: 'visual',
    ai: { mode: 'best' }
  })
}))
vi.mock('../../src/main/screenshot', () => ({
  captureRegionAtCursor: async (_p: string, mode: unknown) => {
    overlayModes.push(mode)
    return screenshotResult
  },
  captureFullscreenAtCursor: async () => screenshotResult,
  captureRepeatRegion: async () => repeatResult
}))
vi.mock('../../src/main/lastCapture', () => ({ getLastRegion: () => lastRegion }))
let captureCounter = 0
vi.mock('../../src/main/captureContent', () => ({
  recognizeCapture: async (options: { sourceId?: string }) => {
    const n = ++captureCounter
    recognizeCalls.push(n)
    await recognizeDelay(n)
    if (recognizeFailures.has(n)) throw new Error('providers failed')
    const sourceId = options.sourceId ?? `src${n}`
    return {
      blocks: [{ id: `b${n}`, sourceId, type: 'paragraph', html: `Фрагмент ${n}.` }],
      source: { id: sourceId, capturedAt: 1 },
      output: { notice: null, offlineFallback: false }
    }
  },
  discardCapture: async () => {},
  heuristicTitle: () => 'Заголовок'
}))
vi.mock('../../src/main/imageStore', () => ({ saveDocumentImage: async () => 'img1', deleteNoteImage: async () => {} }))
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

const idle = async (p: Awaited<ReturnType<typeof load>>): Promise<void> => p.getOcrQueue()!.whenIdle()
const lastHud = (): HudState => hudStates[hudStates.length - 1]
const htmls = (id: string): string[] => notes.get(id)!.blocks!.map((b) => (b as { html: string }).html)
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('Capture Session (§13) and capture targets (§1) with the background queue', () => {
  beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'snap-pipeline-'))
    notes.clear()
    nextId = 1
    captureCounter = 0
    hudStates.length = 0
    overlayModes.length = 0
    screenshotResult = Buffer.from('png')
    repeatResult = { ok: true, buffer: Buffer.from('repeat') }
    lastRegion = { displayId: 1 }
    pickChoice = 'new'
    captureNoNote = 'new'
    recognizeDelay = async () => undefined
    recognizeFailures = new Set()
    recognizeCalls = []
  })
  afterEach(() => rmSync(userData, { recursive: true, force: true }))

  it('session: captures go to the session note in order, whatever note is open meanwhile', async () => {
    const p = await load()
    await p.toggleCaptureSession('preload')
    expect(p.isCaptureSessionActive()).toBe(true)
    await idle(p)
    const [sessionNote] = Array.from(notes.values())

    notes.set('other', note('other', 'Другая'))
    p.setActiveNoteId('other')
    await p.runCapture('region', 'preload')
    expect(overlayModes.at(-1)).toEqual({ session: { count: 1 } })
    await idle(p)
    expect(htmls(sessionNote.id)).toEqual(['Фрагмент 1.', 'Фрагмент 2.'])
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
    await idle(p)
    screenshotResult = null
    await p.runCapture('region', 'preload')
    expect(lastHud()).toMatchObject({ kind: 'session', session: { count: 1 } })
  })

  it('undo removes exactly that capture and decrements the session counter', async () => {
    const p = await load()
    await p.toggleCaptureSession('preload')
    await idle(p)
    const [n] = Array.from(notes.values())
    const sourceId = (n.blocks![0] as { sourceId: string }).sourceId // the capture's own id
    await p.undoCapture(n.id, sourceId)
    expect(notes.get(n.id)?.blocks ?? []).toEqual([])
    expect(lastHud()).toMatchObject({ kind: 'message', text: 'Добавление отменено' })
  })

  it('capture goes to the open note; without one a new note is created by default', async () => {
    const p = await load()
    await p.runCapture('region', 'preload')
    await idle(p)
    expect(notes.size).toBe(1)
    const [created] = Array.from(notes.values())
    expect(created.autoCreated).toBe(true)
    expect(created.title).toBe('Заголовок') // the new note is titled from its text
    expect(lastHud()).toMatchObject({ kind: 'added', noteId: created.id })

    notes.set('open', note('open', 'Открытая'))
    p.setActiveNoteId('open')
    await p.runCapture('region', 'preload')
    await idle(p)
    expect(notes.get('open')!.blocks).toHaveLength(1)
  })

  it('"ask" mode: the HUD picker chooses the note; cancel adds nothing', async () => {
    captureNoNote = 'ask'
    notes.set('recent', note('recent', 'Недавняя'))
    const p = await load()
    pickChoice = 'recent'
    await p.runCapture('region', 'preload')
    await idle(p)
    expect(notes.get('recent')!.blocks).toHaveLength(1)

    p.setActiveNoteId(null)
    pickChoice = null
    await p.runCapture('region', 'preload')
    expect(notes.size).toBe(1)
    expect(notes.get('recent')!.blocks).toHaveLength(1)
  })
})

describe('background OCR queue behind the capture hotkey', () => {
  beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'snap-pipeline-'))
    notes.clear()
    nextId = 1
    captureCounter = 0
    hudStates.length = 0
    overlayModes.length = 0
    screenshotResult = Buffer.from('png')
    repeatResult = { ok: true, buffer: Buffer.from('repeat') }
    lastRegion = { displayId: 1 }
    pickChoice = 'new'
    captureNoNote = 'new'
    recognizeDelay = async () => undefined
    recognizeFailures = new Set()
    recognizeCalls = []
    notes.set('A', note('A', 'Заметка A'))
    notes.set('B', note('B', 'Заметка B'))
  })
  afterEach(() => rmSync(userData, { recursive: true, force: true }))

  it('a capture returns before recognition has even started to finish, and says "accepted"', async () => {
    let release: () => void = () => undefined
    recognizeDelay = (n) => (n === 1 ? new Promise<void>((r) => (release = r)) : Promise.resolve())
    const p = await load()
    p.setActiveNoteId('A')
    await p.runCapture('region', 'preload')
    expect(lastHud()).toMatchObject({ kind: 'queue', phase: 'captured', text: 'Принято · в очереди: 1' })
    expect(notes.get('A')!.blocks).toEqual([]) // nothing recognized yet — and the user is already free
    // a second capture is possible right now, while the first is still being recognized
    await p.runCapture('region', 'preload')
    expect(lastHud()).toMatchObject({ kind: 'queue', phase: 'captured', text: 'Принято · в очереди: 2' })
    release()
    await idle(p)
    expect(htmls('A')).toEqual(['Фрагмент 1.', 'Фрагмент 2.'])
  })

  it('the target note is fixed at capture time: switching notes while processing does not redirect it', async () => {
    let release: () => void = () => undefined
    recognizeDelay = (n) => (n === 1 ? new Promise<void>((r) => (release = r)) : Promise.resolve())
    const p = await load()
    p.setActiveNoteId('A')
    await p.runCapture('region', 'preload')
    p.setActiveNoteId('B') // the user moves on to another note
    await p.runCapture('region', 'preload')
    release()
    await idle(p)
    expect(htmls('A')).toEqual(['Фрагмент 1.'])
    expect(htmls('B')).toEqual(['Фрагмент 2.'])
  })

  it('Repeat Last Capture works while the worker is busy', async () => {
    let release: () => void = () => undefined
    recognizeDelay = (n) => (n === 1 ? new Promise<void>((r) => (release = r)) : Promise.resolve())
    const p = await load()
    p.setActiveNoteId('A')
    await p.runCapture('region', 'preload') // busy with #1
    await p.runRepeatCapture('preload')
    await p.runRepeatCapture('preload')
    await p.runRepeatCapture('preload')
    expect(lastHud()).toMatchObject({ kind: 'queue', phase: 'captured', text: 'Принято · в очереди: 4' })
    release()
    await idle(p)
    expect(htmls('A')).toEqual(['Фрагмент 1.', 'Фрагмент 2.', 'Фрагмент 3.', 'Фрагмент 4.'])
  })

  it('if the screen layout changed, Repeat falls back to a normal selection', async () => {
    repeatResult = { ok: false, reason: 'layout_changed' }
    const p = await load()
    p.setActiveNoteId('A')
    await p.runRepeatCapture('preload')
    await idle(p)
    expect(overlayModes).toHaveLength(1) // the selection overlay was opened
    expect(htmls('A')).toEqual(['Фрагмент 1.'])
  })

  it('a second selection overlay is the only thing that blocks a new capture', async () => {
    const p = await load()
    expect(p.beginSelection()).toBe(true)
    expect(p.beginSelection()).toBe(false) // an overlay is already open
    p.endSelection()
    expect(p.beginSelection()).toBe(true)
    p.endSelection()
  })

  it('one failed capture gets a placeholder and does not block the ones after it', async () => {
    recognizeFailures = new Set([2, 3, 4]) // three attempts of capture #2 fail
    process.env.SNAP_NOTES_OCR_BACKOFF_MS = '5,5' // the real pause between attempts is seconds
    const p = await load()
    p.setActiveNoteId('A')
    for (let i = 0; i < 3; i++) await p.runCapture('region', 'preload')
    await idle(p)
    delete process.env.SNAP_NOTES_OCR_BACKOFF_MS
    const texts = notes.get('A')!.blocks!.map((b) => (b as { html: string }).html)
    expect(texts[0]).toBe('Фрагмент 1.')
    expect(texts[1]).toBe('⚠️ Не удалось распознать фрагмент')
    expect(texts[2]).toMatch(/^Фрагмент \d+\.$/)
    expect(p.getOcrQueue()!.getQueueState().failed).toBe(1)
    expect(lastHud()).toMatchObject({ kind: 'queue', phase: 'failed' })
  })

  it('20 captures in a row: every one accepted at once, exactly 20 results in the right order', async () => {
    recognizeDelay = (n) => wait(5 + ((n * 7) % 20)) // the AI is slower than the user
    const p = await load()
    p.setActiveNoteId('A')
    const t0 = Date.now()
    for (let i = 0; i < 20; i++) await p.runCapture('region', 'preload')
    const acceptedIn = Date.now() - t0
    expect(overlayModes).toHaveLength(20) // the selection overlay opened 20 times without waiting
    expect(recognizeCalls.length).toBeLessThan(20) // recognition was still going on in the background
    await idle(p)
    expect(htmls('A')).toEqual(Array.from({ length: 20 }, (_, i) => `Фрагмент ${i + 1}.`))
    expect(acceptedIn).toBeLessThan(5000)
    expect(lastHud()).toMatchObject({ kind: 'queue', phase: 'done', text: expect.stringContaining('20 фрагментов добавлено') })
    // nothing is left on disk
    expect(readdirSync(path.join(userData, 'ocr-queue')).filter((f) => f !== 'state.json')).toEqual([])
  })

  it('"undo last recognition" removes the newest capture only', async () => {
    const p = await load()
    p.setActiveNoteId('A')
    for (let i = 0; i < 3; i++) await p.runCapture('region', 'preload')
    await idle(p)
    expect(await p.undoLastCapture()).toBe(true)
    expect(htmls('A')).toEqual(['Фрагмент 1.', 'Фрагмент 2.'])
  })
})
