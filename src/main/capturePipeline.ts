import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import stringSimilarity from 'string-similarity'
import { IPC } from '../shared/ipc'
import * as notesStore from './notesStore'
import * as settingsStore from './settingsStore'
import { extractHtmlWithFallback, extractHtmlHybrid } from './ai/router'
import { AiError } from './ai/errors'
import { captureRegionAtCursor, captureFullscreenAtCursor } from './screenshot'
import { htmlToPlainText } from '../shared/htmlText'
import { blocksToPlainText } from '../shared/ocrBlocks'
import { looksIncomplete } from '../shared/completeness'
import { saveToCache } from './screenshotCache'
import { ToastPayload } from '../shared/types'

let activeNoteId: string | null = null
let capturing = false
let getWin: (() => BrowserWindow | null) | null = null

export function initCapturePipeline(getMainWindow: () => BrowserWindow | null): void {
  getWin = getMainWindow
}

export function setActiveNoteId(id: string | null): void {
  activeNoteId = id
}

function broadcast(channel: string, payload?: unknown): void {
  const win = getWin?.() ?? null
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
}

function toast(type: ToastPayload['type'], message: string): void {
  const win = getWin?.() ?? null
  if (!win || win.isDestroyed()) return
  const payload: ToastPayload = { id: randomUUID(), type, message }
  win.webContents.send(IPC.ON_TOAST, payload)
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

export async function runCapture(kind: 'region' | 'fullscreen', preloadPath: string): Promise<void> {
  if (capturing) return
  capturing = true

  try {
    const settings = settingsStore.getSettings()
    if (settings.aiKeys.length === 0) {
      toast('error', 'Не задан ни один API-ключ. Откройте настройки, чтобы добавить ключ.')
      return
    }

    let buffer: Buffer | null
    try {
      buffer = kind === 'region' ? await captureRegionAtCursor(preloadPath) : await captureFullscreenAtCursor()
    } catch (err) {
      toast('error', `Не удалось сделать скриншот: ${(err as Error).message}`)
      return
    }
    if (!buffer) return

    if (settings.screenshotCacheEnabled) {
      saveToCache(buffer).catch(() => {})
    }

    let note = activeNoteId ? notesStore.getNote(activeNoteId) : undefined
    let isNew = false
    if (!note) {
      note = await notesStore.createNote()
      isNew = true
      activeNoteId = note.id
      broadcast(IPC.ON_NOTE_CREATED, note)
      broadcast(IPC.ON_NAVIGATE, { view: 'editor', noteId: note.id })
    }

    broadcast(IPC.ON_NOTE_PROCESSING_START, note.id)
    try {
      const existingContext = isNew ? undefined : htmlToPlainText(note.body).slice(-800)

      const localKey = settings.aiKeys.find((k) => k.provider === 'local')
      const cloudKeys = settings.aiKeys.filter((k) => k.provider !== 'local')

      const { html, blocks } =
        settings.useHybridPipeline && localKey
          ? await extractHtmlHybrid(localKey, cloudKeys, buffer, settings.ocrPreset, existingContext)
          : await extractHtmlWithFallback(settings.aiKeys, buffer, settings.ocrPreset, existingContext)
      const plainText = blocksToPlainText(blocks)

      if (!plainText.trim()) {
        toast('warning', 'На скриншоте не удалось найти текст.')
      } else if (!isNew && isDuplicateText(note.body, plainText)) {
        toast('warning', 'Похожий текст уже есть — пропущено.')
      } else {
        const flagged = looksIncomplete(plainText)
        const marker = flagged ? '<p class="ocr-flag">⚠️ Похоже, текст поместился не полностью</p>' : ''
        const nextBody = note.body + marker + html
        const updated = await notesStore.updateNote(note.id, { body: nextBody })
        if (updated) {
          broadcast(IPC.ON_NOTE_UPDATED, updated)
          toast(flagged ? 'warning' : 'success', flagged ? 'Текст добавлен, но похоже, поместился не весь' : 'Текст добавлен')
        }
      }
    } catch (err) {
      const message = err instanceof AiError ? err.message : 'Не удалось распознать текст на изображении.'
      toast('error', message)
    } finally {
      broadcast(IPC.ON_NOTE_PROCESSING_END, note.id)
    }
  } finally {
    capturing = false
  }
}
