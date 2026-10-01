import { BrowserWindow, ipcMain } from 'electron'
import stringSimilarity from 'string-similarity'
import { IPC } from '../shared/ipc'
import * as notesStore from './notesStore'
import * as settingsStore from './settingsStore'
import { captureRegionAtCursor, captureFullscreenAtCursor } from './screenshot'
import { htmlToPlainText } from '../shared/htmlText'
import { blocksToText, newBlockId, type Block } from '../shared/blocks'
import { looksIncomplete } from '../shared/completeness'
import { formatRoutingNotice } from '../shared/usageFormat'
import { saveToCache } from './screenshotCache'
import type { Note } from '../shared/types'
import type { HudSession } from '../shared/hud'
import type { RecognitionService } from './providers/recognition'
import { AllProvidersFailedError } from './providers/router'
import { discardCapture, recognizeCapture, type CaptureResult } from './captureContent'
import { readForegroundWindow } from './windowInfo'
import * as hud from './hud'
import { logEvent } from './logger'

let activeNoteId: string | null = null
let capturing = false
let getWin: (() => BrowserWindow | null) | null = null
let recognition: RecognitionService | null = null
let preload = ''

/** Capture Session (§13): several captures appended to one note, in capture order. */
let session: { noteId: string; count: number } | null = null

export function initCapturePipeline(getMainWindow: () => BrowserWindow | null, service: RecognitionService): void {
  getWin = getMainWindow
  recognition = service
  // Enter / Esc in the selection overlay during a session finish it.
  ipcMain.on(IPC.OVERLAY_FINISH_SESSION, () => finishCaptureSession())
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

function broadcast(channel: string, payload?: unknown): void {
  const win = getWin?.() ?? null
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
}

export function noteTitle(note: Note | undefined): string {
  return note?.title.trim() || 'Новая заметка'
}

function sessionInfo(): HudSession | undefined {
  if (!session) return undefined
  return { count: session.count, noteTitle: noteTitle(notesStore.getNote(session.noteId)) }
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

function isDuplicateText(existingBodyHtml: string, newText: string): boolean {
  const normalizedNew = normalize(newText)
  if (!normalizedNew) return false

  const existingPlain = htmlToPlainText(existingBodyHtml)
  const normalizedBody = normalize(existingPlain)
  if (normalizedBody && normalizedBody.includes(normalizedNew)) return true

  const chunks = existingPlain
    .split(/\n{1,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)

  for (const chunk of chunks) {
    const similarity = stringSimilarity.compareTwoStrings(normalize(chunk), normalizedNew)
    if (similarity >= 0.82) return true
  }

  if (normalizedBody) {
    const overall = stringSimilarity.compareTwoStrings(normalizedBody, normalizedNew)
    if (overall >= 0.9) return true
  }

  return false
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

async function createAndOpenNote(): Promise<Note> {
  const note = await notesStore.createNote()
  activeNoteId = note.id
  broadcast(IPC.ON_NOTE_CREATED, note)
  broadcast(IPC.ON_NAVIGATE, { view: 'editor', noteId: note.id })
  return note
}

/** Where a capture goes: the session note, the open note, or (no note open) a new one / the user's pick. */
async function resolveTarget(): Promise<{ note: Note; isNew: boolean } | null> {
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
  return { note: await createAndOpenNote(), isNew: true }
}

/**
 * Capture to Note (§1): select a region → recognize → structured blocks go into the open note (a new
 * note when none is open, or the Capture Session's note). The editor then moves them to the caret.
 * Progress and the result appear in the HUD, with Undo and Open.
 */
export async function runCapture(kind: 'region' | 'fullscreen', preloadPath: string): Promise<void> {
  if (capturing) return
  capturing = true
  preload = preloadPath
  // Before the overlay takes focus: which app/window the user is capturing from.
  const windowInfo = readForegroundWindow()

  try {
    const settings = settingsStore.getSettings()
    if (!recognition) return

    let buffer: Buffer | null
    try {
      buffer =
        kind === 'region'
          ? await captureRegionAtCursor(preloadPath, session ? { session: { count: session.count } } : {})
          : await captureFullscreenAtCursor()
    } catch (err) {
      hud.show({ kind: 'message', tone: 'error', text: `Не удалось сделать скриншот: ${(err as Error).message}`, session: sessionInfo() })
      return
    }
    if (!buffer) {
      if (session) hud.show({ kind: 'session', session: sessionInfo()! })
      return
    }

    if (settings.screenshotCacheEnabled) {
      saveToCache(buffer).catch(() => {})
    }

    const target = await resolveTarget()
    if (!target) return
    const { note, isNew } = target

    hud.show({ kind: 'working', text: 'Распознаю…', session: sessionInfo() })
    broadcast(IPC.ON_NOTE_PROCESSING_START, note.id)
    try {
      const result = await recognizeCapture({ png: buffer, noteId: note.id, recognition, withImages: true, windowInfo })
      const detail = result.output.notice ? formatRoutingNotice(result.output.notice) : undefined
      const plainText = blocksToText(result.blocks)

      if (result.blocks.length === 0) {
        hud.show({ kind: 'message', tone: 'warning', text: 'На скриншоте не удалось найти текст.', session: sessionInfo() })
      } else if (!isNew && !session && plainText.trim() && isDuplicateText(note.body, plainText)) {
        await discardCapture(note.id, result)
        hud.show({ kind: 'message', tone: 'warning', text: 'Похожий текст уже есть в заметке — пропущено.' })
      } else {
        const { blocks, flagged } = withCompletenessFlag(result)
        const updated = await notesStore.appendBlocks(note.id, blocks, result.source)
        if (updated) {
          broadcast(IPC.ON_NOTE_UPDATED, updated)
          // The editor moves the new blocks to the caret if the caret was in this note's text.
          broadcast(IPC.ON_CAPTURE_ADDED, { noteId: note.id, sourceId: result.source.id })
          if (session) {
            session.count += 1
            hud.setSession(sessionInfo() ?? null)
          }
          hud.show({
            kind: 'added',
            tone: flagged || result.output.offlineFallback ? 'warning' : 'success',
            noteId: note.id,
            noteTitle: noteTitle(updated),
            sourceId: result.source.id,
            detail: flagged ? 'Похоже, текст поместился не полностью' : detail,
            session: sessionInfo()
          })
        }
      }
    } catch (err) {
      logEvent('capture', { kind, error: err instanceof Error ? err.name : 'unknown' })
      hud.show({ kind: 'message', tone: 'error', text: recognitionErrorMessage(err), session: sessionInfo() })
    } finally {
      broadcast(IPC.ON_NOTE_PROCESSING_END, note.id)
    }
  } finally {
    capturing = false
  }
}

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
  const note = open && open.deletedAt === null ? open : await createAndOpenNote()
  session = { noteId: note.id, count: 0 }
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
  hud.show({
    kind: 'added',
    tone: 'success',
    noteId: finished.noteId,
    noteTitle: noteTitle(note),
    detail: `Сессия завершена · фрагментов: ${finished.count}`
  })
}

/** HUD "Отменить": removes the capture's blocks, metadata and original screenshot. */
export async function undoCapture(noteId: string, sourceId: string): Promise<void> {
  const updated = await notesStore.removeSource(noteId, sourceId)
  if (!updated) return
  broadcast(IPC.ON_NOTE_UPDATED, updated)
  if (session && session.noteId === noteId && session.count > 0) {
    session.count -= 1
    hud.setSession(sessionInfo() ?? null)
  }
  hud.show({ kind: 'message', tone: 'warning', text: 'Добавление отменено', session: sessionInfo() })
}
