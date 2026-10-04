import {
  committableJobs,
  EMPTY_QUEUE_STATE,
  type OcrJob,
  type OcrJobOrigin,
  type OcrJobResult,
  type OcrJobWindowInfo,
  type OcrQueueState
} from '../../shared/ocrJob'

/**
 * Background OCR queue. Capturing only calls `enqueue()` (screenshot + job record on disk) and is
 * done; this service recognizes the jobs in the background and writes the text into the notes.
 *
 * - Jobs are persisted, so a crash or restart loses nothing (`recoverPendingJobs`).
 * - Up to `maxConcurrent` jobs are recognized at the same time (default 1). Results are always
 *   written per note in capture order, whatever order the AI answers in.
 * - A job that keeps failing gets a "could not recognize" placeholder in its position, so it never
 *   blocks the jobs behind it, and can be retried later.
 *
 * Nothing here touches Electron or the note store directly; everything goes through `QueueDeps`.
 */

export interface JobStore {
  /** Next monotonic capture number (never reused, survives restarts). */
  nextSequence(): Promise<number>
  save(job: OcrJob): Promise<void>
  /** Deletes the job record and its temporary screenshot. */
  remove(job: OcrJob): Promise<void>
  loadAll(): Promise<OcrJob[]>
  writeImage(id: string, png: Buffer): Promise<string>
  readImage(job: OcrJob): Promise<Buffer>
}

export interface QueueSettings {
  /** Jobs recognized at the same time (1–3). */
  maxConcurrent: number
  /** Off = captures are still accepted and kept, but not processed until turned on. */
  enabled: boolean
}

export interface RunSummary {
  total: number
  done: number
  failed: number
  empty: number
  noteIds: string[]
  /** The last note that received text (for the "Open" button). */
  lastNoteId?: string
}

export interface QueueDeps {
  store: JobStore
  getSettings: () => QueueSettings
  /** Screenshot → blocks. Saves nothing into the note; may throw (the job is retried). */
  recognize: (job: OcrJob, png: Buffer) => Promise<OcrJobResult>
  /** Writes a recognized job into its note (appends, or replaces the placeholder for retries). */
  commit: (job: OcrJob, result: OcrJobResult) => Promise<void>
  /** Writes the "could not recognize" placeholder in the job's position. */
  commitPlaceholder: (job: OcrJob) => Promise<void>
  /** Nothing was recognized: drop what recognition stored (and an empty note the capture created). */
  commitEmpty: (job: OcrJob, result: OcrJobResult) => Promise<void>
  /** The job will not be written (cancelled / note gone): remove what recognition stored. */
  discard: (job: OcrJob, result: OcrJobResult | undefined) => Promise<void>
  noteExists: (noteId: string) => boolean
  newId: () => string
  now: () => number
  sleep: (ms: number) => Promise<void>
  onState: (state: OcrQueueState) => void
  onRunFinished: (summary: RunSummary) => void
  onJobCommitted?: (job: OcrJob, result: OcrJobResult) => void
  onJobFailed?: (job: OcrJob) => void
  log?: (event: Record<string, unknown>) => void
  /** Pause between automatic attempts of a failing job. */
  backoffMs?: number[]
  maxAttempts?: number
  /** Failed jobs are kept this long for a retry. */
  failedTtlMs?: number
  /** Captures closer than this to the end of the previous run extend it instead of starting a new one. */
  runGraceMs?: number
}

export interface EnqueueInput {
  png: Buffer
  targetNoteId: string
  origin: OcrJobOrigin
  createdNote?: boolean
  captureSessionId?: string
  windowInfo?: OcrJobWindowInfo
  withImages?: boolean
  providerMode?: string
}

const DEFAULT_BACKOFF = [3000, 10_000]
const DAY = 24 * 60 * 60 * 1000
/** Captures into one note within this gap belong to the same batch. */
const BATCH_GAP_MS = 10 * 60 * 1000

export class OCRQueueService {
  private readonly jobs = new Map<string, OcrJob>()
  private inFlight = 0
  private paused = false
  private commitChain: Promise<void> = Promise.resolve()
  private enqueueChain: Promise<unknown> = Promise.resolve()
  private readonly cancelled = new Set<string>()
  private run = { ...EMPTY_QUEUE_STATE.run, noteIds: new Set<string>(), reported: true, lastNoteId: undefined as string | undefined, lastActive: 0 }
  private draining = false
  private removing = 0
  private readonly lastBatch = new Map<string, { id: string; at: number }>()
  private idleWaiters: (() => void)[] = []

  constructor(private readonly deps: QueueDeps) {}

  // ---------------------------------------------------------------------------------------------
  // public API

  /**
   * Accepts a capture. When this resolves the screenshot and the job record are safely on disk and
   * the caller is free to continue; recognition is not awaited.
   */
  enqueue(input: EnqueueInput): Promise<OcrJob> {
    // Publish accepted captures in call order. A small, later screenshot must not become
    // visible to workers while an earlier one is still being persisted.
    const accepted = this.enqueueChain.then(() => this.persistCapture(input))
    this.enqueueChain = accepted.catch(() => undefined)
    return accepted
  }

  private async persistCapture(input: EnqueueInput): Promise<OcrJob> {
    const sequenceNumber = await this.deps.store.nextSequence()
    const id = this.deps.newId()
    const sourceImagePath = await this.deps.store.writeImage(id, input.png)
    const now = this.deps.now()
    const job: OcrJob = {
      id,
      sequenceNumber,
      createdAt: now,
      updatedAt: now,
      sourceImagePath,
      targetNoteId: input.targetNoteId,
      targetBlockPosition: 'end',
      batchId: this.batchFor(input.targetNoteId, now, input.captureSessionId),
      ...(input.captureSessionId ? { captureSessionId: input.captureSessionId } : {}),
      origin: input.origin,
      providerMode: input.providerMode ?? '',
      status: 'QUEUED',
      attempts: 0,
      createdNote: input.createdNote === true,
      sourceId: `c${id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20)}`,
      ...(input.windowInfo ? { windowInfo: input.windowInfo } : {}),
      withImages: input.withImages !== false
    }
    await this.deps.store.save(job)
    // Accepted only now: the job survives a crash from this point on.
    this.jobs.set(job.id, job)
    this.startOrContinueRun(now)
    this.run.total += 1
    this.emit()
    this.schedule()
    // A snapshot: the worker keeps changing the live record while the caller holds this one.
    return { ...job }
  }

  /** Brings back jobs that were waiting or running when the app stopped. */
  async recoverPendingJobs(): Promise<number> {
    const loaded = await this.deps.store.loadAll()
    let recovered = 0
    for (const job of loaded) {
      if (this.jobs.has(job.id)) continue
      if (job.status === 'COMPLETED' || job.status === 'CANCELLED') {
        await this.deps.store.remove(job)
        continue
      }
      if (job.status === 'PROCESSING') job.status = 'QUEUED' // interrupted: start again
      if (job.status === 'READY' && !job.result) job.status = 'QUEUED'
      this.jobs.set(job.id, job)
      if (job.status !== 'FAILED') recovered++
    }
    if (recovered > 0) {
      this.run = { total: recovered, done: 0, failed: 0, empty: 0, noteIds: new Set(), reported: false, lastNoteId: undefined, lastActive: this.deps.now() }
    }
    await this.purgeStale()
    this.emit()
    this.schedule()
    // Jobs that were already recognized (or failed) before the stop only need to be written.
    void this.commitReady()
    return recovered
  }

  getQueueState(): OcrQueueState {
    let queued = 0
    let processing = 0
    let buffered = 0
    let failed = 0
    for (const job of this.jobs.values()) {
      if (job.status === 'QUEUED') queued++
      else if (job.status === 'PROCESSING') processing++
      else if (job.status === 'READY') buffered++
      else if (job.status === 'FAILED') failed++
    }
    return {
      queued,
      processing,
      buffered,
      failed,
      active: queued + processing + buffered,
      run: { total: this.run.total, done: this.run.done, failed: this.run.failed, empty: this.run.empty, noteId: this.run.lastNoteId }
    }
  }

  /** Notes that have captures waiting or being recognized (shown as "working" in the UI). */
  getPendingNoteIds(): Set<string> {
    const ids = new Set<string>()
    for (const job of this.jobs.values()) if (job.status === 'QUEUED' || job.status === 'PROCESSING' || job.status === 'READY') ids.add(job.targetNoteId)
    return ids
  }

  /** The window the capture came from becomes known a moment after the screenshot was accepted. */
  setWindowInfo(jobId: string, info: OcrJobWindowInfo): void {
    const job = this.jobs.get(jobId)
    if (!job || job.windowInfo || job.status === 'COMPLETED' || job.status === 'CANCELLED') return
    // Kept in memory; it is written to disk with the job's next state change.
    job.windowInfo = info
  }

  getJob(id: string): OcrJob | undefined {
    return this.jobs.get(id)
  }

  listJobs(): OcrJob[] {
    return [...this.jobs.values()].sort((a, b) => a.sequenceNumber - b.sequenceNumber)
  }

  /** Cancels a job that has not been written yet. A job that is being recognized is dropped when it finishes. */
  async cancel(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId)
    if (!job || job.status === 'COMPLETED') return false
    if (job.status === 'PROCESSING') {
      this.cancelled.add(job.id)
      return true
    }
    await this.finalizeCancelled(job, true)
    return true
  }

  /** Retries one failed job; its result replaces the placeholder in the note. */
  async retry(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId)
    if (!job || job.status !== 'FAILED') return false
    if (job.placeholderWritten) job.replacesSource = true
    job.status = 'QUEUED'
    job.attempts = 0
    delete job.error
    delete job.result
    job.updatedAt = this.deps.now()
    await this.deps.store.save(job)
    this.startOrContinueRun(this.deps.now())
    this.run.total += 1
    this.emit()
    this.schedule()
    return true
  }

  async retryFailed(): Promise<number> {
    let count = 0
    for (const job of this.listJobs()) if (job.status === 'FAILED' && (await this.retry(job.id))) count++
    return count
  }

  /** Turns background processing off / on. Captures keep being accepted while it is off. */
  setPaused(paused: boolean): void {
    this.paused = paused
    if (!paused) this.schedule()
  }

  /** Resolves when nothing is queued, running or waiting to be written. */
  whenIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.push(resolve))
  }

  // ---------------------------------------------------------------------------------------------
  // processing

  private isIdle(): boolean {
    for (const job of this.jobs.values()) if (job.status === 'QUEUED' || job.status === 'PROCESSING' || job.status === 'READY') return false
    return this.inFlight === 0 && !this.draining && this.removing === 0
  }

  private schedule(): void {
    queueMicrotask(() => this.pump())
  }

  private pump(): void {
    const settings = this.deps.getSettings()
    if (this.paused || !settings.enabled) return
    const max = Math.min(3, Math.max(1, Math.floor(settings.maxConcurrent) || 1))
    while (this.inFlight < max) {
      const next = [...this.jobs.values()].filter((j) => j.status === 'QUEUED').sort((a, b) => a.sequenceNumber - b.sequenceNumber)[0]
      if (!next) break
      next.status = 'PROCESSING'
      this.inFlight++
      void this.process(next).finally(() => {
        this.inFlight--
        this.pump()
        this.finishRunIfDone()
        this.settleIdle()
      })
    }
  }

  private async process(job: OcrJob): Promise<void> {
    const maxAttempts = this.deps.maxAttempts ?? 3
    const backoff = this.deps.backoffMs ?? DEFAULT_BACKOFF
    job.updatedAt = this.deps.now()
    this.emit()
    try {
      await this.deps.store.save(job)
      let png: Buffer | null = null
      try {
        png = await this.deps.store.readImage(job)
      } catch {
        job.error = 'Скриншот не найден на диске'
        await this.settle(job, 'FAILED')
      }
      while (png && job.status === 'PROCESSING') {
        try {
          const result = await this.deps.recognize(job, png)
          if (this.cancelled.has(job.id)) {
            await this.deps.discard(job, result)
            await this.finalizeCancelled(job, true)
            return
          }
          job.result = result
          // Persisted first, visible to the writer second: a job that is already written (and its
          // files removed) can never be saved again by this worker.
          await this.settle(job, 'READY')
        } catch (err) {
          job.attempts += 1
          job.error = err instanceof Error ? err.message : String(err)
          this.deps.log?.({ queue: 'attempt-failed', job: job.sequenceNumber, attempt: job.attempts })
          if (this.cancelled.has(job.id)) {
            await this.finalizeCancelled(job, true)
            return
          }
          if (job.attempts >= maxAttempts) {
            await this.settle(job, 'FAILED')
          } else {
            await this.deps.store.save(job)
            await this.deps.sleep(backoff[Math.min(job.attempts - 1, backoff.length - 1)] ?? 3000)
          }
        }
      }
    } catch (err) {
      // The store itself failed: keep the job in memory as failed rather than losing track of it.
      job.status = 'FAILED'
      job.error = err instanceof Error ? err.message : String(err)
    }
    this.emit()
    await this.commitReady()
  }

  /** Records the outcome of recognition on disk, then publishes it to the writer. */
  private async settle(job: OcrJob, status: 'READY' | 'FAILED'): Promise<void> {
    job.updatedAt = this.deps.now()
    await this.deps.store.save({ ...job, status })
    job.status = status
  }

  /** Writes whatever is allowed to be written, one job at a time, in capture order per note. */
  private commitReady(): Promise<void> {
    this.commitChain = this.commitChain.then(() => this.drain()).catch(() => undefined)
    return this.commitChain
  }

  private async drain(): Promise<void> {
    this.draining = true
    try {
      for (;;) {
        const next = committableJobs([...this.jobs.values()])[0]
        if (!next) break
        await this.commitOne(next)
      }
    } finally {
      this.draining = false
    }
    this.emit()
    this.finishRunIfDone()
    this.settleIdle()
  }

  private async commitOne(job: OcrJob): Promise<void> {
    if (!this.deps.noteExists(job.targetNoteId)) {
      // The note was deleted while its captures were waiting.
      if (job.result) await this.deps.discard(job, job.result)
      await this.finalizeCancelled(job, false)
      return
    }
    if (job.status === 'FAILED') {
      try {
        await this.deps.commitPlaceholder(job)
      } catch (err) {
        this.deps.log?.({ queue: 'placeholder-failed', error: err instanceof Error ? err.name : 'unknown' })
      }
      job.placeholderWritten = true
      this.run.failed += 1
      this.run.noteIds.add(job.targetNoteId)
      job.updatedAt = this.deps.now()
      await this.deps.store.save(job).catch(() => undefined) // kept for "Retry"
      this.deps.onJobFailed?.(job)
      return
    }
    const result = job.result as OcrJobResult
    try {
      if (result.empty) {
        await this.deps.commitEmpty(job, result)
        this.run.empty += 1
      } else {
        await this.deps.commit(job, result)
        this.run.done += 1
        this.run.noteIds.add(job.targetNoteId)
        this.run.lastNoteId = job.targetNoteId
        this.deps.onJobCommitted?.(job, result)
      }
      job.status = 'COMPLETED'
      this.jobs.delete(job.id)
      await this.removeFiles(job)
    } catch (err) {
      // Could not be written (note store error): treat like a recognition failure so it gets a placeholder.
      job.status = 'FAILED'
      job.error = err instanceof Error ? err.message : String(err)
      await this.deps.discard(job, result).catch(() => undefined)
      delete job.result
    }
  }

  /** `release`: also let the jobs behind it be written (not when called from inside the write loop itself). */
  private async finalizeCancelled(job: OcrJob, release: boolean): Promise<void> {
    job.status = 'CANCELLED'
    this.cancelled.delete(job.id)
    this.jobs.delete(job.id)
    if (!this.run.reported && this.run.total > 0) this.run.total -= 1
    await this.removeFiles(job)
    this.emit()
    if (release) await this.commitReady() // later jobs of the same note may now be released
  }

  // ---------------------------------------------------------------------------------------------
  // bookkeeping

  /** Deletes a job's record and screenshot; the queue only counts as idle once this is done. */
  private async removeFiles(job: OcrJob): Promise<void> {
    this.removing++
    try {
      await this.deps.store.remove(job)
    } catch {
      /* a leftover temp file is cleaned at the next start */
    } finally {
      this.removing--
    }
  }

  /**
   * Captures that follow each other closely count as one run ("12 captures added"): a new run starts
   * only after the queue has been quiet for a few seconds.
   */
  private startOrContinueRun(now: number): void {
    const grace = this.deps.runGraceMs ?? 4000
    if (this.run.reported && now - this.run.lastActive > grace) {
      this.run = { total: 0, done: 0, failed: 0, empty: 0, noteIds: new Set(), reported: false, lastNoteId: undefined, lastActive: now }
    }
    this.run.reported = false
    this.run.lastActive = now
  }

  private batchFor(noteId: string, now: number, sessionId?: string): string {
    if (sessionId) return `session-${sessionId}`
    const last = this.lastBatch.get(noteId)
    if (last && now - last.at < BATCH_GAP_MS) {
      last.at = now
      return last.id
    }
    const id = `batch-${this.deps.newId()}`
    this.lastBatch.set(noteId, { id, at: now })
    return id
  }

  private emit(): void {
    this.deps.onState(this.getQueueState())
  }

  private finishRunIfDone(): void {
    if (this.run.reported || this.run.total === 0) return
    for (const job of this.jobs.values()) if (job.status === 'QUEUED' || job.status === 'PROCESSING' || job.status === 'READY') return
    if (this.inFlight > 0) return
    this.run.reported = true
    this.run.lastActive = this.deps.now()
    this.deps.onRunFinished({
      total: this.run.total,
      done: this.run.done,
      failed: this.run.failed,
      empty: this.run.empty,
      noteIds: [...this.run.noteIds],
      lastNoteId: this.run.lastNoteId
    })
  }

  private settleIdle(): void {
    if (!this.isIdle() || this.idleWaiters.length === 0) return
    const waiters = this.idleWaiters
    this.idleWaiters = []
    for (const resolve of waiters) resolve()
  }

  /** Failed jobs older than the retention period are dropped with their screenshots. */
  async purgeStale(): Promise<void> {
    const ttl = this.deps.failedTtlMs ?? 7 * DAY
    const cutoff = this.deps.now() - ttl
    for (const job of [...this.jobs.values()]) {
      if (job.status === 'FAILED' && job.updatedAt < cutoff) {
        this.jobs.delete(job.id)
        await this.removeFiles(job)
      }
    }
  }
}
