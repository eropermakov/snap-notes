import { promises as fs } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type { OcrJob } from '../../shared/ocrJob'
import type { JobStore } from './OCRQueueService'

const SAFE_ID = /^[a-zA-Z0-9_-]{1,64}$/

/**
 * Jobs on disk: `<dir>/<id>.json` (metadata and, once recognized, the result) and `<dir>/<id>.png`
 * (the captured screenshot). Records are replaced atomically, so a crash never leaves half a file.
 * `<dir>/state.json` holds the last used capture number: numbers are never reused.
 */
export function createFileJobStore(dir: string): JobStore & { cleanOrphans(): Promise<number> } {
  const statePath = path.join(dir, 'state.json')
  let lastSequence: number | null = null
  let sequenceLock: Promise<unknown> = Promise.resolve()

  const jobPath = (id: string): string => path.join(dir, `${id}.json`)
  const imagePath = (id: string): string => path.join(dir, `${id}.png`)

  async function writeAtomic(target: string, data: string | Buffer): Promise<void> {
    await fs.mkdir(dir, { recursive: true })
    const temp = `${target}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temp, data)
      await fs.rename(temp, target)
    } finally {
      await fs.rm(temp, { force: true }).catch(() => undefined)
    }
  }

  async function readLast(): Promise<number> {
    if (lastSequence !== null) return lastSequence
    let value = 0
    try {
      const parsed = JSON.parse(await fs.readFile(statePath, 'utf-8')) as { lastSequence?: unknown }
      if (typeof parsed.lastSequence === 'number' && Number.isFinite(parsed.lastSequence)) value = parsed.lastSequence
    } catch {
      /* first start */
    }
    // The counter file may be missing or behind after a crash: never go below the jobs on disk.
    try {
      for (const file of await fs.readdir(dir)) {
        if (!file.endsWith('.json') || file === 'state.json') continue
        try {
          const job = JSON.parse(await fs.readFile(path.join(dir, file), 'utf-8')) as { sequenceNumber?: unknown }
          if (typeof job.sequenceNumber === 'number') value = Math.max(value, job.sequenceNumber)
        } catch {
          /* skip unreadable record */
        }
      }
    } catch {
      /* directory does not exist yet */
    }
    lastSequence = value
    return value
  }

  return {
    nextSequence(): Promise<number> {
      // Serialized: ten captures in the same millisecond still get ten different, increasing numbers.
      const next = sequenceLock.then(async () => {
        const value = (await readLast()) + 1
        lastSequence = value
        await writeAtomic(statePath, JSON.stringify({ lastSequence: value }))
        return value
      })
      sequenceLock = next.catch(() => undefined)
      return next
    },

    async save(job: OcrJob): Promise<void> {
      if (!SAFE_ID.test(job.id)) throw new Error('bad job id')
      await writeAtomic(jobPath(job.id), JSON.stringify(job))
    },

    async remove(job: OcrJob): Promise<void> {
      if (!SAFE_ID.test(job.id)) return
      await fs.rm(jobPath(job.id), { force: true })
      await fs.rm(imagePath(job.id), { force: true })
    },

    async loadAll(): Promise<OcrJob[]> {
      let files: string[]
      try {
        files = await fs.readdir(dir)
      } catch {
        return []
      }
      const jobs: OcrJob[] = []
      for (const file of files) {
        if (!file.endsWith('.json') || file === 'state.json') continue
        try {
          const job = JSON.parse(await fs.readFile(path.join(dir, file), 'utf-8')) as OcrJob
          if (job && SAFE_ID.test(job.id) && typeof job.sequenceNumber === 'number' && typeof job.targetNoteId === 'string') {
            job.sourceImagePath = imagePath(job.id)
            jobs.push(job)
          }
        } catch {
          /* a half-written / corrupt record is ignored */
        }
      }
      return jobs.sort((a, b) => a.sequenceNumber - b.sequenceNumber)
    },

    async writeImage(id: string, png: Buffer): Promise<string> {
      if (!SAFE_ID.test(id)) throw new Error('bad job id')
      await writeAtomic(imagePath(id), png)
      return imagePath(id)
    },

    readImage(job: OcrJob): Promise<Buffer> {
      if (!SAFE_ID.test(job.id)) return Promise.reject(new Error('bad job id'))
      return fs.readFile(imagePath(job.id))
    },

    /** Screenshots without a job record (a crash between the two writes) are deleted. */
    async cleanOrphans(): Promise<number> {
      let removed = 0
      let files: string[] = []
      try {
        files = await fs.readdir(dir)
      } catch {
        return 0
      }
      const records = new Set(files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)))
      for (const file of files) {
        const isTemp = file.endsWith('.tmp')
        const isOrphanImage = file.endsWith('.png') && !records.has(file.slice(0, -4))
        if (isTemp || isOrphanImage) {
          await fs.rm(path.join(dir, file), { force: true }).catch(() => undefined)
          removed++
        }
      }
      return removed
    }
  }
}
