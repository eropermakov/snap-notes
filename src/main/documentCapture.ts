import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { IPC } from '../shared/ipc'
import * as notesStore from './notesStore'
import * as settingsStore from './settingsStore'
import { captureRegionAtCursor } from './screenshot'
import { AiError } from './ai/errors'
import { buildDocumentNoteBody } from './documentBuilder'
import { ToastPayload } from '../shared/types'

let capturing = false
let getWin: (() => BrowserWindow | null) | null = null

export function initDocumentCapture(getMainWindow: () => BrowserWindow | null): void {
  getWin = getMainWindow
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

export async function runDocumentCapture(preloadPath: string): Promise<void> {
  if (capturing) return
  capturing = true

  try {
    const settings = settingsStore.getSettings()
    const geminiKey = settings.aiKeys.find((k) => k.provider === 'gemini' && k.apiKey.trim())
    if (!geminiKey) {
      toast('error', 'Эта функция пока работает только через Gemini — добавьте ключ Gemini в Настройках.')
      return
    }

    let buffer: Buffer | null
    try {
      buffer = await captureRegionAtCursor(preloadPath)
    } catch (err) {
      toast('error', `Не удалось сделать скриншот: ${(err as Error).message}`)
      return
    }
    if (!buffer) return

    const note = await notesStore.createNote({ title: 'Документ из скриншота' })
    broadcast(IPC.ON_NOTE_CREATED, note)
    broadcast(IPC.ON_NAVIGATE, { view: 'editor', noteId: note.id })
    broadcast(IPC.ON_NOTE_PROCESSING_START, note.id)

    try {
      const result = await buildDocumentNoteBody(note.id, geminiKey.apiKey, buffer)
      if (!result) {
        toast('warning', 'Не удалось найти текст или фото на скриншоте.')
        return
      }

      const updated = await notesStore.updateNote(note.id, { body: result.html })
      if (updated) {
        broadcast(IPC.ON_NOTE_UPDATED, updated)
        toast('success', 'Документ создан')
      }
    } catch (err) {
      const message = err instanceof AiError ? err.message : 'Не удалось распознать содержимое скриншота.'
      toast('error', message)
    } finally {
      broadcast(IPC.ON_NOTE_PROCESSING_END, note.id)
    }
  } finally {
    capturing = false
  }
}
