import { clipboard } from 'electron'
import { createHash } from 'crypto'
import { ClipboardImageWatcher } from '../shared/clipboardImage'

const POLL_MS = 1500

/** Cheap identity of the clipboard image: size + hash of a 16×16 thumbnail (never the full bitmap). */
export function clipboardFingerprint(): string | null {
  if (!clipboard.availableFormats().some((f) => f.startsWith('image/'))) return null
  const image = clipboard.readImage()
  if (image.isEmpty()) return null
  const { width, height } = image.getSize()
  const thumb = image.resize({ width: 16, height: 16, quality: 'good' })
  return `${width}x${height}:${createHash('sha1').update(thumb.toBitmap()).digest('hex')}`
}

/** The clipboard image as PNG, or null when the clipboard holds no picture. */
export function readClipboardPng(): Buffer | null {
  const image = clipboard.readImage()
  if (image.isEmpty()) return null
  const png = image.toPNG()
  return png.length > 0 ? png : null
}

let watcher: ClipboardImageWatcher | null = null
let timer: ReturnType<typeof setInterval> | null = null

/** Polls the clipboard while the "Suggest OCR for clipboard images" setting is on. */
export function startClipboardWatch(onNewImage: (key: string) => void): void {
  stopClipboardWatch()
  watcher = new ClipboardImageWatcher(clipboardFingerprint, onNewImage)
  watcher.poll() // the picture that is already there is not "new"
  timer = setInterval(() => watcher?.poll(), POLL_MS)
}

export function stopClipboardWatch(): void {
  if (timer) clearInterval(timer)
  timer = null
  watcher = null
}

/** An image recognized by command is never offered afterwards. */
export function markClipboardImageHandled(): void {
  watcher?.markHandled(clipboardFingerprint())
}
