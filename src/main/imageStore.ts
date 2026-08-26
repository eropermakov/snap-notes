import { app, protocol, nativeImage } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'

const SCHEME = 'snap-media'
const SAFE_ID = /^[a-zA-Z0-9-]+$/

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
])

let imagesRoot: string | null = null

function getImagesRoot(): string {
  if (!imagesRoot) imagesRoot = path.join(app.getPath('userData'), 'images')
  return imagesRoot
}

function resolveSafeImagePath(noteId: string, imageId: string): string | null {
  if (!SAFE_ID.test(noteId) || !SAFE_ID.test(imageId)) return null
  const root = path.resolve(getImagesRoot())
  const filePath = path.resolve(path.join(root, noteId, `${imageId}.png`))
  if (filePath !== root && !filePath.startsWith(root + path.sep)) return null
  return filePath
}

export function initImageProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const imageId = url.pathname.replace(/^\//, '').replace(/\.png$/i, '')
      const filePath = resolveSafeImagePath(url.hostname, imageId)
      if (!filePath) {
        return new Response('Not found', { status: 404 })
      }
      const data = await fs.readFile(filePath)
      return new Response(data, { headers: { 'content-type': 'image/png' } })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

export async function readNoteImage(noteId: string, imageId: string): Promise<Buffer | null> {
  const filePath = resolveSafeImagePath(noteId, imageId)
  if (!filePath) return null
  try {
    return await fs.readFile(filePath)
  } catch {
    return null
  }
}

export async function saveDocumentImage(noteId: string, pngBuffer: Buffer): Promise<string> {
  const dir = path.join(getImagesRoot(), noteId)
  await fs.mkdir(dir, { recursive: true })
  const imageId = randomUUID()
  await fs.writeFile(path.join(dir, `${imageId}.png`), pngBuffer)
  return imageId
}

export function imageSrc(noteId: string, imageId: string): string {
  return `${SCHEME}://${noteId}/${imageId}.png`
}

export async function deleteNoteImages(noteId: string): Promise<void> {
  if (!SAFE_ID.test(noteId)) return
  await fs.rm(path.join(getImagesRoot(), noteId), { recursive: true, force: true }).catch(() => {})
}

export async function deleteAllImages(): Promise<void> {
  await fs.rm(getImagesRoot(), { recursive: true, force: true }).catch(() => {})
}

/** Crops a region from a PNG buffer. bbox is [ymin, xmin, ymax, xmax] normalized 0-1000 (Gemini object-detection convention). */
export function cropToPng(pngBuffer: Buffer, bbox: [number, number, number, number]): Buffer | null {
  const img = nativeImage.createFromBuffer(pngBuffer)
  const { width, height } = img.getSize()
  if (!width || !height) return null

  const [ymin, xmin, ymax, xmax] = bbox
  const x = Math.max(0, Math.min(width - 1, Math.round((xmin / 1000) * width)))
  const y = Math.max(0, Math.min(height - 1, Math.round((ymin / 1000) * height)))
  const w = Math.max(0, Math.min(width - x, Math.round(((xmax - xmin) / 1000) * width)))
  const h = Math.max(0, Math.min(height - y, Math.round(((ymax - ymin) / 1000) * height)))
  if (w <= 0 || h <= 0) return null

  const cropped = img.crop({ x, y, width: w, height: h })
  if (cropped.isEmpty()) return null
  return cropped.toPNG()
}
