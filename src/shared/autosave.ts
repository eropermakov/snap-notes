export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export interface AutosaverOptions<T> {
  /** Quiet time after the last change before writing (default 1000 ms). */
  delay?: number
  save: (payload: T) => Promise<void>
  onState?: (state: SaveState) => void
}

/**
 * Debounced autosave: many changes → one write ~1 s after the last one. `flush()` writes a pending
 * change immediately (closing, switching note, app exit). A failed write keeps the change pending
 * and reports 'error'; the next change or flush retries it.
 */
export class Autosaver<T> {
  private timer: ReturnType<typeof setTimeout> | undefined
  private pending: { payload: T } | null = null
  private inFlight: Promise<void> | null = null
  private state: SaveState = 'idle'
  private readonly delay: number

  constructor(private readonly options: AutosaverOptions<T>) {
    this.delay = options.delay ?? 1000
  }

  getState(): SaveState {
    return this.state
  }

  hasPending(): boolean {
    return this.pending !== null
  }

  schedule(payload: T): void {
    this.pending = { payload }
    this.setState('saving')
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.write(), this.delay)
  }

  /** Resolves when everything pending (and anything already being written) is on disk or failed. */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (this.inFlight) await this.inFlight.catch(() => undefined)
    if (this.pending) await this.write()
  }

  /** Drops the pending change without saving (the note was deleted or replaced from outside). */
  cancel(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.pending = null
    if (this.state === 'saving') this.setState('idle')
  }

  private async write(): Promise<void> {
    this.timer = undefined
    const job = this.pending
    if (!job) return
    this.pending = null
    this.setState('saving')
    const run = this.options.save(job.payload).then(
      () => {
        // A newer change arrived while writing: stay in 'saving' until that one is written.
        this.setState(this.pending ? 'saving' : 'saved')
      },
      () => {
        if (!this.pending) this.pending = job
        this.setState('error')
      }
    )
    this.inFlight = run
    await run
    if (this.inFlight === run) this.inFlight = null
  }

  private setState(state: SaveState): void {
    if (this.state === state) return
    this.state = state
    this.options.onState?.(state)
  }
}
