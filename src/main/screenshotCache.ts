import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'

let cacheDir: string | null = null

function getCacheDir(): string {
  if (!cacheDir) cacheDir = path.join(app.getPath('userData'), 'screenshot-cache')
  return cacheDir
}

export async function initScreenshotCache(): Promise<void> {
  await fs.mkdir(getCacheDir(), { recursive: true })
}

export async function saveToCache(pngBuffer: Buffer): Promise<void> {
  const dir = getCacheDir()
  const filename = `${Date.now()}-${randomUUID().slice(0, 8)}.png`
  await fs.writeFile(path.join(dir, filename), pngBuffer)
}

export async function purgeExpired(retentionHours: number): Promise<void> {
  const dir = getCacheDir()
  const cutoff = Date.now() - retentionHours * 60 * 60 * 1000
  let files: string[]
  try {
    files = await fs.readdir(dir)
  } catch {
    return
  }
  for (const file of files) {
    const filePath = path.join(dir, file)
    try {
      const stat = await fs.stat(filePath)
      if (stat.mtimeMs < cutoff) {
        await fs.unlink(filePath)
      }
    } catch {
      /* ignore */
    }
  }
}

export async function clearCache(): Promise<void> {
  const dir = getCacheDir()
  let files: string[]
  try {
    files = await fs.readdir(dir)
  } catch {
    return
  }
  await Promise.all(files.map((file) => fs.unlink(path.join(dir, file)).catch(() => {})))
}

export async function getCacheStats(): Promise<{ bytes: number; count: number }> {
  const dir = getCacheDir()
  let files: string[]
  try {
    files = await fs.readdir(dir)
  } catch {
    return { bytes: 0, count: 0 }
  }
  let bytes = 0
  for (const file of files) {
    try {
      const stat = await fs.stat(path.join(dir, file))
      bytes += stat.size
    } catch {
      /* ignore */
    }
  }
  return { bytes, count: files.length }
}

export function getCacheDirPath(): string {
  return getCacheDir()
}
