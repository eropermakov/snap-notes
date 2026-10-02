import { app, BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import path from 'path'
import { IPC } from '../shared/ipc'
import * as notesStore from './notesStore'
import * as settingsStore from './settingsStore'
import { captureRegionAtCursor, captureFullscreenAtCursor, captureRepeatRegion } from './screenshot'
import { getLastRegion } from './lastCapture'
import { htmlToPlainText } from '../shared/htmlText'
import { blocksToText, newBlockId, type Block } from '../shared/blocks'
import { looksIncomplete } from '../shared/completeness'
import { formatRoutingNotice } from '../shared/usageFormat'
import { plural } from '../shared/noteStats'
import { saveToCache } from './screenshotCache'
import type { Note } from '../shared/types'
import type { HudSession } from '../shared/hud'
import type { OcrJob, OcrJobOrigin, OcrJobResult } from '../shared/ocrJob'
import type { RecognitionService } from './providers/recognition'
import { AllProvidersFailedError } from './providers/router'
import { discardCapture, heuristicTitle, recognizeCapture, type CaptureResult } from './captureContent'
import { readForegroundWindow, type ForegroundWindowInfo } from './windowInfo'
import { broadcastNoteEvent } from './noteWindows'
import { deleteNoteImage, saveDocumentImage } from './imageStore'
import { OCRQueueService, type RunSummary } from './ocr/OCRQueueService'
import { createFileJobStore } from './ocr/jobStore'
import { collapseRunaway, trimOverlap } from '../shared/repeatGuard'
import * as hud from './hud'
import { logEvent } from './logger'

let activeNoteId: string | null = null
/** A selection overlay is open. This is the only thing that blocks a new capture. */
let selecting = false
let recognition: RecognitionService | null = null
let queue: OCRQueueService | null = null
let queueStore: ReturnType<typeof createFileJobStore> | null = null
let preload = ''
/** Folder shown in the UI: notes created by a capture go there. */
let activeFolderId: string | null = null
/** The newest written capture, for Undo and the single-capture notice. */
let lastCommit: { noteId: string; sourceId: string; notice?: string; warn: boolean } | null = null
let hudTimer: ReturnType<typeof setTimeout> | null = null
let lastHudText = ''
let pendingNotes = new Set<string>()

/** Capture Session (§13): several captures appended to one note, in capture order. */
let session: { id: string; noteId: string; count: number } | null = null

const CAPTURED_NOTICE_MS = 1400

export function initCapturePipeline(_getMainWindow: () => BrowserWindow | null, service: RecognitionService): OCRQueueService {
  recognition = service
  // Enter / Esc in the selection overlay during a session finish it.
  ipcMain.on(IPC.OVERLAY_FINISH_SESSION, () => finishCaptureSession())
  const store = createFileJobStore(path.join(app.getPath('userData'), 'ocr-queue'))
  queueStore = store
  queue = new OCRQueueService({
    store,
    getSettings: () => {
      const s = settingsStore.getSettings()
      return { enabled: s.ocrQueueEnabled, maxConcurrent: s.ocrMaxConcurrent }
    },
    recognize: recognizeJob,
    commit: commitJob,
    commitPlaceholder: (job) => writePlaceholder(job, store.readImage(job)),
    commitEmpty: async (job, result) => {
      await discardCapture(job.targetNoteId, result as unknown as CaptureResult)
      if (job.createdNote) await discardEmptyAutoNote(job.targetNoteId)
    },
    discard: async (job, result) => {
      if (result) await discardCapture(job.targetNoteId, result as unknown as CaptureResult)
      if (job.createdNote) await discardEmptyAutoNote(job.targetNoteId)
    },
    noteExists: (id) => {
      const note = notesStore.getNote(id)
      return Boolean(note && note.deletedAt === null)
    },
    newId: () => randomUUID(),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    onState: (state) => {
      broadcastNoteEvent(IPC.ON_OCR_QUEUE, state)
      syncProcessingNotes()
      showProgress()
    },
    onRunFinished: showRunSummary,
    log: (event) => logEvent('ocr-queue', event),
    ...backoffFromEnv()
  })
  return queue
}

/** Pause between automatic attempts of a failing capture (shortened by tests through the environment). */
function backoffFromEnv(): { backoffMs?: number[] } {
  const raw = process.env.SNAP_NOTES_OCR_BACKOFF_MS
  if (!raw) return {}
  const list = raw.split(',').map(Number).filter((n) => Number.isFinite(n) && n >= 0)
  return list.length ? { backoffMs: list } : {}
}

/** Start-up: remove leftovers, then bring back captures that were waiting when the app stopped. */
export async function recoverOcrQueue(): Promise<number> {
  if (!queue || !queueStore) return 0
  await queueStore.cleanOrphans().catch(() => 0)
  return queue.recoverPendingJobs()
}

export function getOcrQueue(): OCRQueueService | null {
  return queue
}

export function recognitionErrorMessage(err: unknown): string {
  if (err instanceof AllProvidersFailedError) {
    if (err.attempts.length === 0) return 'Нет доступного источника распознавания. Проверьте раздел «ИИ и распознавание» в настройках.'
    return 'Не удалось распознать: все источники вернули ошибку. Подробности — в разделе «Использование ИИ».'
  }
  return 'Не удалось распознать текст на изображении.'
}

export function setActiveNoteId(id: string | null): void {
  activeNoteId = id
}

export function getActiveNoteId(): string | null {
  return activeNoteId
}

export function setActiveFolderId(id: string | null): void {
  activeFolderId = id
}

/** A note with captures waiting or being recognized must not be cleaned up as "empty". */
export function isNoteProcessing(id: string): boolean {
  return pendingNotes.has(id) || Boolean(queue?.getPendingNoteIds().has(id))
}

function broadcast(channel: string, payload?: unknown): void {
  broadcastNoteEvent(channel, payload)
}

export function noteTitle(note: Note | undefined): string {
  return note?.title.trim() || 'Новая заметка'
}

function sessionInfo(): HudSession | undefined {
  if (!session) return undefined
  return { count: session.count, noteTitle: noteTitle(notesStore.getNote(session.noteId)) }
}

/** Adds the "text may be cut off" warning (existing completeness heuristic) as its own block. */
export function withCompletenessFlag(result: CaptureResult): { blocks: Block[]; flagged: boolean } {
  // Only a trailing paragraph can look "cut off": lists, tables and code rarely end with a period.
  const last = result.blocks[result.blocks.length - 1]
  const flagged = last?.type === 'paragraph' && looksIncomplete(blocksToText([last]))
  if (!flagged) return { blocks: result.blocks, flagged }
  return {
    blocks: [
      { id: newBlockId(), sourceId: result.source.id, type: 'paragraph', tone: 'warning', html: '⚠️ Похоже, текст поместился не полностью' },
      ...result.blocks
    ],
    flagged
  }
}

// -------------------------------------------------------------------------------------------------
// foreground: accept a capture

/** A note made by a capture (not by the user): removed again if it stays empty. */
export async function createCaptureNote(): Promise<Note> {
  const note = await notesStore.createNote({ autoCreated: true, folderId: activeFolderId })
  activeNoteId = note.id
  broadcast(IPC.ON_NOTE_CREATED, note)
  broadcast(IPC.ON_NAVIGATE, { view: 'editor', noteId: note.id })
  return note
}

/** Where a capture goes: the session note, the open note, or (no note open) a new one / the user's pick. */
async function resolveTarget(preferredId?: string | null): Promise<{ note: Note; isNew: boolean } | null> {
  if (preferredId) {
    const preferred = notesStore.getNote(preferredId)
    if (preferred && preferred.deletedAt === null) return { note: preferred, isNew: false }
  }
  if (session) {
    const sessionNote = notesStore.getNote(session.noteId)
    if (sessionNote && sessionNote.deletedAt === null) return { note: sessionNote, isNew: false }
  }
  const open = activeNoteId ? notesStore.getNote(activeNoteId) : undefined
  if (open && open.deletedAt === null) return { note: open, isNew: false }

  if (settingsStore.getSettings().captureNoNote === 'ask') {
    const recent = notesStore
      .listNotes()
      .slice(0, 5)
      .map((n) => ({ id: n.id, title: noteTitle(n) === 'Новая заметка' ? htmlToPlainText(n.body).slice(0, 40) || 'Без названия' : noteTitle(n) }))
    const choice = await hud.pickNote(recent)
    if (choice === null) return null
    if (choice !== 'new') {
      const picked = notesStore.getNote(choice)
      if (picked && picked.deletedAt === null) {
        activeNoteId = picked.id
        return { note: picked, isNew: false }
      }
    }
  }
  return { note: await createCaptureNote(), isNew: true }
}

/** The single selection overlay: another capture can start only after it closed (never because of OCR work). */
export function beginSelection(): boolean {
  if (selecting) return false
  selecting = true
  return true
}

export function endSelection(): void {
  selecting = false
}

export interface AcceptOptions {
  origin: OcrJobOrigin
  /** Put the result into this note instead of the open one. */
  targetNoteId?: string | null
  /** The note was just created for this capture (Capture to New Note). */
  createdNote?: boolean
  /** Not part of the running Capture Session (Capture to New Note makes its own note). */
  ignoreSession?: boolean
  /** Started when the hotkey fired; resolved later and attached to the job. */
  windowInfo?: Promise<ForegroundWindowInfo>
}

/**
 * The whole foreground path of a capture: pick the note, write the screenshot and the job record to
 * disk, tell the user "accepted". No recognition, no AI, no waiting — the caller is free right after.
 */
export async function acceptCapture(buffer: Buffer, options: AcceptOptions): Promise<OcrJob | null> {
  if (!queue) return null
  const settings = settingsStore.getSettings()
  if (settings.screenshotCacheEnabled) saveToCache(buffer).catch(() => {})

  const target: { note: Note; isNew: boolean } | null = options.createdNote && options.targetNoteId
    ? await (async () => {
        const note = notesStore.getNote(options.targetNoteId as string)
        return note ? { note, isNew: true } : null
      })()
    : await resolveTarget(options.targetNoteId)
  if (!target) return null
  const inSession = Boolean(session) && !options.ignoreSession
  try {
    const job = await queue.enqueue({
      png: buffer,
      targetNoteId: target.note.id,
      origin: inSession ? 'session' : options.origin,
      createdNote: target.isNew,
      ...(inSession && session ? { captureSessionId: session.id } : {}),
      providerMode: settings.ai.mode,
      withImages: true
    })
    if (inSession && session) {
      session.count += 1
      hud.setSession(sessionInfo() ?? null)
    }
    if (options.windowInfo) void options.windowInfo.then((info) => queue?.setWindowInfo(job.id, info))
    pendingNotes.add(target.note.id)
    showCaptured(job)
    return job
  } catch (err) {
    logEvent('capture', { error: err instanceof Error ? err.name : 'unknown', stage: 'enqueue' })
    hud.show({ kind: 'message', tone: 'error', text: 'Не удалось сохранить снимок. Проверьте свободное место на диске.', session: sessionInfo() })
    if (target.isNew) await discardEmptyAutoNote(target.note.id)
    return null
  }
}

export interface CaptureOptions {
  /** An image that is already in hand (clipboard, file, repeated area): no selection overlay. */
  buffer?: Buffer
  /** Put the result into this note instead of the open one. */
  targetNoteId?: string | null
  origin?: OcrJobOrigin
}

/**
 * Capture to Note: select a region → the screenshot goes to the OCR queue → done. The user is back in
 * their app immediately and can capture again right away; recognition and insertion into the note
 * happen in the background, in capture order.
 */
export async function runCapture(kind: 'region' | 'fullscreen', preloadPath: string, options: CaptureOptions = {}): Promise<void> {
  preload = preloadPath
  let buffer: Buffer | null = options.buffer ?? null
  let windowInfo: Promise<ForegroundWindowInfo> | undefined

  if (!buffer) {
    // Only a second selection overlay at the same moment is refused — never because of OCR work.
    if (!beginSelection()) return
    // Before the overlay takes focus: which app/window the user is capturing from.
    windowInfo = readForegroundWindow()
    try {
      buffer = kind === 'region' ? await captureRegionAtCursor(preloadPath, session ? { session: { count: session.count } } : {}) : await captureFullscreenAtCursor()
    } catch (err) {
      hud.show({ kind: 'message', tone: 'error', text: `Не удалось сделать скриншот: ${(err as Error).message}`, session: sessionInfo() })
      return
    } finally {
      endSelection()
    }
  }
  if (!buffer) {
    if (session) hud.show({ kind: 'session', session: sessionInfo()! })
    return
  }
  await acceptCapture(buffer, { origin: options.origin ?? 'screen', targetNoteId: options.targetNoteId, windowInfo })
}

/** "Repeat last capture": the same screen area again; if the layout changed, a normal selection. */
export async function runRepeatCapture(preloadPath: string): Promise<void> {
  const region = getLastRegion()
  if (!region) {
    hud.show({ kind: 'message', tone: 'warning', text: 'Ещё не было захвата области — выделите её.' })
    await runCapture('region', preloadPath)
    return
  }
  const windowInfo = readForegroundWindow()
  const repeat = await captureRepeatRegion(region)
  if (!repeat.ok) {
    const why = repeat.reason === 'display_missing' ? 'Монитор с прошлой областью недоступен' : 'Разрешение или расположение экранов изменилось'
    hud.show({ kind: 'message', tone: 'warning', text: `${why} — выделите область заново.` })
    await runCapture('region', preloadPath)
    return
  }
  // Works while the queue is busy: it is just one more capture in the line.
  await acceptCapture(repeat.buffer, { origin: 'repeat', windowInfo })
}

/** Recognizes an image that is not on screen (clipboard, file) into the open note or a new one. */
export async function runImageOcr(png: Buffer, preloadPath: string, targetNoteId?: string | null): Promise<void> {
  preload = preloadPath
  await acceptCapture(png, { origin: targetNoteId ? 'file' : 'clipboard', targetNoteId })
}

// -------------------------------------------------------------------------------------------------
// background: recognition and writing

async function recognizeJob(job: OcrJob, png: Buffer): Promise<OcrJobResult> {
  if (!recognition) throw new Error('recognition is not ready')
  const result = await recognizeCapture({
    png,
    noteId: job.targetNoteId,
    recognition,
    withImages: job.withImages,
    windowInfo: job.windowInfo ? Promise.resolve(job.windowInfo) : undefined,
    sourceId: job.sourceId
  })
  // A looping answer is cut down before anything else looks at it (also before the "cut off" check).
  const guarded = settingsStore.getSettings().ocrTrimRepeats ? collapseRunaway(result.blocks) : { blocks: result.blocks, removed: 0 }
  const { blocks, flagged } = withCompletenessFlag({ ...result, blocks: guarded.blocks })
  return {
    blocks,
    source: { ...result.source, jobId: job.id },
    empty: guarded.blocks.length === 0,
    ...(guarded.removed ? { repeatsRemoved: guarded.removed } : {}),
    offlineFallback: result.output.offlineFallback,
    flagged,
    ...(result.output.notice ? { notice: formatRoutingNotice(result.output.notice) } : {})
  }
}

async function commitJob(job: OcrJob, result: OcrJobResult): Promise<void> {
  const noteId = job.targetNoteId
  let updated: Note | null
  let notice = result.notice
  if (result.repeatsRemoved) notice = [notice, 'Зациклившийся повтор в ответе убран'].filter(Boolean).join(' · ')
  if (job.replacesSource) {
    // Retry of a failed capture: the new text takes the place of the "could not recognize" note.
    const previousImage = notesStore.getNote(noteId)?.sources?.[job.sourceId]?.imageId
    updated = await notesStore.replaceSourceBlocks(noteId, job.sourceId, result.blocks)
    updated = (await notesStore.putSource(noteId, result.source)) ?? updated
    if (previousImage && previousImage !== result.source.imageId) await deleteNoteImage(noteId, previousImage)
  } else {
    // Committing is idempotent: after a crash between "written" and "marked done" the job is committed again.
    if (notesStore.getNote(noteId)?.sources?.[job.sourceId]) return
    const trimmed = trimCaptureOverlap(noteId, result.blocks)
    if (trimmed.removed) notice = [notice, `Повтор с предыдущим снимком убран: ${trimmed.removed}`].filter(Boolean).join(' · ')
    updated = await notesStore.appendBlocks(noteId, trimmed.blocks, result.source)
    // A note made by this capture gets a short local title from its first meaningful line.
    if (updated && job.createdNote) updated = (await notesStore.setAutoTitle(noteId, heuristicTitle(result.blocks))) ?? updated
  }
  if (!updated) throw new Error('note not found')
  lastCommit = { noteId, sourceId: job.sourceId, notice, warn: Boolean(result.flagged || result.offlineFallback) }
  broadcast(IPC.ON_NOTE_UPDATED, updated)
  // The editor moves the new blocks to the caret if the caret was in this note's text.
  if (!job.replacesSource) broadcast(IPC.ON_CAPTURE_ADDED, { noteId, sourceId: job.sourceId })
}

/** The lines this capture shares with the end of the previous one (a long page captured in pieces) are not added twice. */
function trimCaptureOverlap(noteId: string, blocks: Block[]): { blocks: Block[]; removed: number } {
  if (!settingsStore.getSettings().ocrTrimRepeats) return { blocks, removed: 0 }
  const existing = notesStore.getNote(noteId)
  const tail = existing?.blocks ?? []
  // The "text may be cut off" warning is not part of the page.
  const [warning, rest] = blocks[0]?.type === 'paragraph' && blocks[0].tone === 'warning' ? [blocks[0], blocks.slice(1)] : [undefined, blocks]
  const result = trimOverlap(tail, rest)
  if (!result.removed) return { blocks, removed: 0 }
  return { blocks: warning ? [warning, ...result.blocks] : result.blocks, removed: result.removed }
}

/** Placeholder in the capture's position: a stuck screenshot never blocks the ones behind it. */
async function writePlaceholder(job: OcrJob, imagePromise: Promise<Buffer>): Promise<void> {
  const noteId = job.targetNoteId
  let imageId: string | undefined
  try {
    imageId = await saveDocumentImage(noteId, await imagePromise)
  } catch {
    /* without the original the placeholder still marks the place */
  }
  const updated = await notesStore.appendBlocks(
    noteId,
    [{ id: newBlockId(), sourceId: job.sourceId, type: 'paragraph', tone: 'warning', html: '⚠️ Не удалось распознать фрагмент' }],
    { id: job.sourceId, capturedAt: job.createdAt, jobId: job.id, failed: true, ...(imageId ? { imageId } : {}), ...(job.windowInfo ?? {}) }
  )
  if (updated) {
    broadcast(IPC.ON_NOTE_UPDATED, updated)
    broadcast(IPC.ON_CAPTURE_ADDED, { noteId, sourceId: job.sourceId })
  }
}

/** Removes an auto-created note that is still empty and tells every window. */
export async function discardEmptyAutoNote(id: string): Promise<boolean> {
  if (isNoteProcessing(id) || session?.noteId === id) return false
  const removed = await notesStore.discardIfEmptyAuto(id)
  if (removed) {
    if (activeNoteId === id) activeNoteId = null
    broadcast(IPC.ON_NOTE_DELETED, id)
  }
  return removed
}

/** Notes with waiting captures show the "working" shimmer in the UI. */
function syncProcessingNotes(): void {
  if (!queue) return
  const now = queue.getPendingNoteIds()
  for (const id of now) if (!pendingNotes.has(id)) broadcast(IPC.ON_NOTE_PROCESSING_START, id)
  for (const id of pendingNotes) if (!now.has(id)) broadcast(IPC.ON_NOTE_PROCESSING_END, id)
  pendingNotes = now
}

// -------------------------------------------------------------------------------------------------
// the small queue indicator (HUD)

function showCaptured(job: OcrJob): void {
  const state = queue?.getQueueState()
  const waiting = state?.active ?? 1
  lastHudText = ''
  if (hudTimer) clearTimeout(hudTimer)
  hud.show({
    kind: 'queue',
    phase: 'captured',
    text: `Принято · в очереди: ${waiting}`,
    jobId: job.id,
    noteId: job.targetNoteId,
    session: sessionInfo()
  })
  hudTimer = setTimeout(() => {
    hudTimer = null
    showProgress(true)
  }, CAPTURED_NOTICE_MS)
}

function showProgress(force = false): void {
  if (!queue || (hudTimer && !force)) return
  const state = queue.getQueueState()
  if (state.active === 0) return
  const finished = state.run.done + state.run.failed + state.run.empty
  const text = state.run.total > 1 ? `Распознаю · ${Math.min(finished + 1, state.run.total)} из ${state.run.total}` : 'Распознаю…'
  const detail = state.queued > 0 ? `В очереди ещё: ${state.queued}` : undefined
  const key = `${text}|${detail ?? ''}`
  if (key === lastHudText && !force) return
  lastHudText = key
  hud.show({ kind: 'queue', phase: 'processing', text, detail, progress: { done: finished, total: state.run.total }, session: sessionInfo() })
}

function showRunSummary(summary: RunSummary): void {
  if (hudTimer) {
    clearTimeout(hudTimer)
    hudTimer = null
  }
  lastHudText = ''
  const feedback = settingsStore.getSettings().ocrFeedback
  const sound = feedback === 'sound'
  const lastId = summary.lastNoteId ?? summary.noteIds[summary.noteIds.length - 1]
  const title = lastId ? noteTitle(notesStore.getNote(lastId)) : ''
  const where = summary.noteIds.length > 1 ? `в ${summary.noteIds.length} ${plural(summary.noteIds.length, 'заметку', 'заметки', 'заметок')}` : `в «${title}»`

  if (summary.failed > 0) {
    hud.show({
      kind: 'queue',
      phase: 'failed',
      text: summary.done > 0 ? `Добавлено ${summary.done}, не удалось ${summary.failed}` : `Не удалось распознать: ${summary.failed}`,
      detail: 'Фрагменты помечены в заметке — можно повторить.',
      noteId: lastId,
      failed: summary.failed,
      session: sessionInfo()
    })
    return
  }
  if (summary.done === 0) {
    if (summary.empty > 0) hud.show({ kind: 'message', tone: 'warning', text: summary.empty > 1 ? 'На скриншотах не удалось найти текст.' : 'На скриншоте не удалось найти текст.', session: sessionInfo() })
    else if (session) hud.show({ kind: 'session', session: sessionInfo()! })
    else hud.show({ kind: 'hidden' })
    return
  }
  if (feedback === 'none') {
    // Quiet mode: no completion notice. A cut-off / offline warning still shows.
    if (lastCommit?.warn && summary.done === 1) {
      hud.show({ kind: 'added', tone: 'warning', noteId: lastCommit.noteId, noteTitle: title, sourceId: lastCommit.sourceId, detail: lastCommit.notice, session: sessionInfo() })
    } else if (session) hud.show({ kind: 'session', session: sessionInfo()! })
    else hud.show({ kind: 'hidden' })
    return
  }
  if (summary.total === 1 && summary.done === 1 && lastCommit) {
    // One capture: the familiar "Added to …" with Undo and Open.
    hud.show({
      kind: 'added',
      tone: lastCommit.warn ? 'warning' : 'success',
      noteId: lastCommit.noteId,
      noteTitle: title,
      sourceId: lastCommit.sourceId,
      detail: lastCommit.notice,
      session: sessionInfo(),
      ...(sound ? { sound: true } : {})
    })
    return
  }
  hud.show({
    kind: 'queue',
    phase: 'done',
    text: `${summary.done} ${plural(summary.done, 'фрагмент добавлен', 'фрагмента добавлено', 'фрагментов добавлено')} ${where}`,
    noteId: lastId,
    session: sessionInfo(),
    ...(sound ? { sound: true } : {})
  })
}

// -------------------------------------------------------------------------------------------------
// capture session

export function isCaptureSessionActive(): boolean {
  return session !== null
}

/** Session hotkey: starts a Capture Session (and its first capture), or finishes the running one. */
export async function toggleCaptureSession(preloadPath: string): Promise<void> {
  if (session) {
    finishCaptureSession()
    return
  }
  preload = preloadPath
  const open = activeNoteId ? notesStore.getNote(activeNoteId) : undefined
  const note = open && open.deletedAt === null ? open : await createCaptureNote()
  session = { id: randomUUID().replace(/-/g, '').slice(0, 12), noteId: note.id, count: 0 }
  hud.setSession(sessionInfo() ?? null)
  hud.show({ kind: 'session', session: sessionInfo()! })
  await runCapture('region', preloadPath)
}

/** "+ Фрагмент" in the HUD. */
export function captureNextInSession(): void {
  if (session) void runCapture('region', preload)
}

export function finishCaptureSession(): void {
  if (!session) return
  const finished = session
  session = null
  hud.setSession(null)
  const note = notesStore.getNote(finished.noteId)
  const state = queue?.getQueueState()
  // Captures of the session may still be recognized in the background: the indicator keeps showing it.
  if (state && state.active > 0) {
    showProgress(true)
    return
  }
  hud.show({
    kind: 'added',
    tone: 'success',
    noteId: finished.noteId,
    noteTitle: noteTitle(note),
    detail: `Сессия завершена · фрагментов: ${finished.count}`
  })
}

// -------------------------------------------------------------------------------------------------
// undo

/** HUD "Отменить": removes the capture's blocks, metadata and original screenshot. */
export async function undoCapture(noteId: string, sourceId: string): Promise<void> {
  const updated = await notesStore.removeSource(noteId, sourceId)
  if (!updated) return
  if (lastCommit?.sourceId === sourceId) lastCommit = null
  broadcast(IPC.ON_NOTE_UPDATED, updated)
  // The capture made this note and nothing else was added: the empty note goes away with it.
  if (await discardEmptyAutoNote(noteId)) {
    hud.show({ kind: 'message', tone: 'warning', text: 'Добавление отменено', session: sessionInfo() })
    return
  }
  if (session && session.noteId === noteId && session.count > 0) {
    session.count -= 1
    hud.setSession(sessionInfo() ?? null)
  }
  hud.show({ kind: 'message', tone: 'warning', text: 'Добавление отменено', session: sessionInfo() })
}

/** "Undo last recognition" without a notice at hand (command palette / menu). */
export async function undoLastCapture(): Promise<boolean> {
  if (!lastCommit) return false
  const { noteId, sourceId } = lastCommit
  await undoCapture(noteId, sourceId)
  return true
}
