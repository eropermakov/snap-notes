import type { Block, OcrSource } from './blocks'

/**
 * Background OCR queue model. A capture is accepted the moment its screenshot and job record are on
 * disk; recognition and writing into the note happen later, in order.
 */

export type OcrJobStatus =
  | 'QUEUED'
  | 'PROCESSING'
  /** Recognized and waiting for the jobs captured before it (same note) to be written first. */
  | 'READY'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'

export type OcrJobOrigin = 'screen' | 'repeat' | 'clipboard' | 'file' | 'session'

export interface OcrJobWindowInfo {
  appName?: string
  windowTitle?: string
}

/** What recognition produced for a job; kept on disk while it waits for its turn to be written. */
export interface OcrJobResult {
  blocks: Block[]
  source: OcrSource
  /** Text could not be found at all: nothing is written, the note is left alone. */
  empty: boolean
  offlineFallback: boolean
  /** The text looks cut off (completeness heuristic): shown as a warning, not as a plain success. */
  flagged?: boolean
  /** Human-readable routing notice ("Распознано: Groq · Gemini: лимит исчерпан"). */
  notice?: string
}

export interface OcrJob {
  id: string
  /** Monotonic capture number: the order of the text in the note follows it. */
  sequenceNumber: number
  createdAt: number
  updatedAt: number
  /** Temporary screenshot on disk (inside the queue folder). */
  sourceImagePath: string
  /** Fixed when the capture was taken: switching notes later never redirects a job. */
  targetNoteId: string
  /** Where in the note the result goes. Results are appended in capture order. */
  targetBlockPosition: 'end'
  /** Consecutive captures into one note share a batch. */
  batchId: string
  captureSessionId?: string
  origin: OcrJobOrigin
  /** AI usage mode when the capture was taken (for diagnostics). */
  providerMode: string
  status: OcrJobStatus
  attempts: number
  /** The note was created by this capture: it gets a title from the text and is removed if empty. */
  createdNote: boolean
  /** Recognized fragments get this source id, so Undo of one capture removes exactly its blocks. */
  sourceId: string
  /** Retry of a failed job: the result replaces the placeholder of this source instead of appending. */
  replacesSource?: boolean
  /** The "could not recognize" placeholder is already in the note. */
  placeholderWritten?: boolean
  windowInfo?: OcrJobWindowInfo
  withImages: boolean
  result?: OcrJobResult
  error?: string
}

export interface OcrQueueState {
  queued: number
  processing: number
  /** Recognized, waiting for earlier captures of the same note. */
  buffered: number
  failed: number
  /** Jobs that still need work (queued + processing + buffered). */
  active: number
  /** Progress of the current run of captures. */
  run: { total: number; done: number; failed: number; empty: number; noteId?: string }
}

export const EMPTY_QUEUE_STATE: OcrQueueState = {
  queued: 0,
  processing: 0,
  buffered: 0,
  failed: 0,
  active: 0,
  run: { total: 0, done: 0, failed: 0, empty: 0 }
}

/** Jobs whose text is not yet in the note. */
export function isPending(job: Pick<OcrJob, 'status'>): boolean {
  return job.status === 'QUEUED' || job.status === 'PROCESSING' || job.status === 'READY'
}

/**
 * The jobs that may be written into their note right now. Per note, jobs are written strictly in
 * capture order: a job is released only when every earlier job of the same note is finished
 * (written, failed with its placeholder, or cancelled). A recognized job whose predecessor is
 * still working simply waits (READY) — a fast answer never jumps the line.
 * Retries of failed jobs replace an existing placeholder, so they do not depend on the order.
 */
export function committableJobs(jobs: readonly OcrJob[]): OcrJob[] {
  const released: OcrJob[] = []
  const byNote = new Map<string, OcrJob[]>()
  for (const job of jobs) {
    if (job.replacesSource) {
      if (job.status === 'READY') released.push(job)
      continue
    }
    const list = byNote.get(job.targetNoteId) ?? []
    list.push(job)
    byNote.set(job.targetNoteId, list)
  }
  for (const list of byNote.values()) {
    list.sort((a, b) => a.sequenceNumber - b.sequenceNumber)
    for (const job of list) {
      if (job.status === 'READY') released.push(job)
      else if (job.status === 'FAILED' && !job.placeholderWritten) released.push(job)
      else if (job.status === 'CANCELLED' || job.status === 'COMPLETED' || (job.status === 'FAILED' && job.placeholderWritten)) continue
      else break // QUEUED / PROCESSING: later jobs of this note wait for it
    }
  }
  return released.sort((a, b) => a.sequenceNumber - b.sequenceNumber)
}

/** Seconds-free text for the progress indicator. */
export function queueProgressText(state: OcrQueueState): string {
  if (state.active === 0) return ''
  const done = state.run.done + state.run.failed + state.run.empty
  return state.run.total > 1 ? `Распознаю · ${done}/${state.run.total}` : 'Распознаю…'
}
