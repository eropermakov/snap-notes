import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { OCRQueueService, type EnqueueInput, type JobStore, type QueueDeps, type QueueSettings, type RunSummary } from '../../src/main/ocr/OCRQueueService'
import { createFileJobStore } from '../../src/main/ocr/jobStore'
import type { OcrJob, OcrJobResult, OcrQueueState } from '../../src/shared/ocrJob'

/** Everything the queue talks to, faked: recognition (with scripted timing / failures) and the notes. */
export interface Harness {
  dir: string
  store: JobStore & { cleanOrphans(): Promise<number> }
  queue: OCRQueueService
  /** Text written into each note, in the order it was written. */
  notes: Map<string, string[]>
  /** Calls in the order they were made. */
  committed: number[]
  placeholders: number[]
  replaced: number[]
  discarded: number[]
  emptied: number[]
  finished: RunSummary[]
  states: OcrQueueState[]
  existingNotes: Set<string>
  settings: QueueSettings
  /** Number of recognitions running at the same moment (max seen). */
  maxInFlight: number
  recognizeStarts: number[]
  sleeps: number[]
  /** Scripted behaviour per capture number. */
  script: (sequence: number, attempt: number) => Promise<void> | void
  files(): string[]
  cleanup(): void
}

export function pngOf(label: string): Buffer {
  // Not a real picture: the fake recognizer only reads the label.
  return Buffer.from(`PNG:${label}`)
}

export function createHarness(options: { dir?: string; settings?: Partial<QueueSettings>; backoffMs?: number[]; maxAttempts?: number } = {}): Harness {
  const dir = options.dir ?? mkdtempSync(path.join(tmpdir(), 'snap-ocr-queue-'))
  const store = createFileJobStore(dir)
  const h: Harness = {
    dir,
    store,
    queue: undefined as never,
    notes: new Map(),
    committed: [],
    placeholders: [],
    replaced: [],
    discarded: [],
    emptied: [],
    finished: [],
    states: [],
    existingNotes: new Set(['A', 'B']),
    settings: { maxConcurrent: 1, enabled: true, ...options.settings },
    maxInFlight: 0,
    recognizeStarts: [],
    sleeps: [],
    script: () => undefined,
    files: () => readdirSync(dir),
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  }
  let inFlight = 0
  let counter = 0
  const deps: QueueDeps = {
    store,
    getSettings: () => h.settings,
    recognize: async (job: OcrJob, png: Buffer): Promise<OcrJobResult> => {
      inFlight++
      h.maxInFlight = Math.max(h.maxInFlight, inFlight)
      h.recognizeStarts.push(job.sequenceNumber)
      try {
        await h.script(job.sequenceNumber, job.attempts)
        const label = png.toString().replace(/^PNG:/, '')
        return {
          blocks: [{ id: `b${job.sequenceNumber}`, sourceId: job.sourceId, type: 'paragraph', html: label }],
          source: { id: job.sourceId, capturedAt: job.createdAt, jobId: job.id },
          empty: label === '',
          offlineFallback: false
        }
      } finally {
        inFlight--
      }
    },
    commit: async (job, result) => {
      const list = h.notes.get(job.targetNoteId) ?? []
      if (job.replacesSource) {
        h.replaced.push(job.sequenceNumber)
        const at = list.findIndex((t) => t.startsWith(`⚠ #${job.sequenceNumber}`))
        list[at] = (result.blocks[0] as { html: string }).html
      } else {
        list.push((result.blocks[0] as { html: string }).html)
      }
      h.notes.set(job.targetNoteId, list)
      h.committed.push(job.sequenceNumber)
    },
    commitPlaceholder: async (job) => {
      const list = h.notes.get(job.targetNoteId) ?? []
      list.push(`⚠ #${job.sequenceNumber}`)
      h.notes.set(job.targetNoteId, list)
      h.placeholders.push(job.sequenceNumber)
    },
    commitEmpty: async (job) => {
      h.emptied.push(job.sequenceNumber)
    },
    discard: async (job) => {
      h.discarded.push(job.sequenceNumber)
    },
    noteExists: (id) => h.existingNotes.has(id),
    newId: () => `job${String(++counter).padStart(4, '0')}x${Math.random().toString(36).slice(2, 8)}`,
    now: () => Date.now(),
    sleep: async (ms) => {
      h.sleeps.push(ms)
    },
    onState: (state) => h.states.push(state),
    onRunFinished: (summary) => h.finished.push(summary),
    backoffMs: options.backoffMs ?? [3000, 10_000],
    maxAttempts: options.maxAttempts ?? 3
  }
  h.queue = new OCRQueueService(deps)
  return h
}

export function capture(h: Harness, label: string, noteId = 'A', extra: Partial<EnqueueInput> = {}): Promise<OcrJob> {
  return h.queue.enqueue({ png: pngOf(label), targetNoteId: noteId, origin: 'screen', ...extra })
}

export const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
