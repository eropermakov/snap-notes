import { afterEach, describe, expect, it } from 'vitest'
import { capture, createHarness, pngOf, wait, type Harness } from './queueHarness'
import { committableJobs, type OcrJob } from '../../src/shared/ocrJob'

const harnesses: Harness[] = []
function make(options: Parameters<typeof createHarness>[0] = {}): Harness {
  const h = createHarness(options)
  harnesses.push(h)
  return h
}
afterEach(() => {
  while (harnesses.length) harnesses.pop()?.cleanup()
})

describe('capture does not wait for recognition', () => {
  it('enqueue resolves while recognition is still running', async () => {
    const h = make()
    let release: () => void = () => undefined
    h.script = () => new Promise<void>((resolve) => (release = resolve))
    const started = Date.now()
    const job = await capture(h, 'one')
    await wait(20)
    expect(Date.now() - started).toBeLessThan(500)
    expect(job.status).toBe('QUEUED')
    // the screenshot and the record are on disk the moment enqueue returns
    expect(h.files().some((f) => f.endsWith('.png'))).toBe(true)
    expect(h.files().some((f) => f.endsWith('.json') && f !== 'state.json')).toBe(true)
    expect(h.committed).toEqual([])
    release()
    await h.queue.whenIdle()
    expect(h.committed).toEqual([1])
  })

  it('accepts 10 captures instantly even though each recognition takes a long time', async () => {
    const h = make()
    h.script = () => wait(40)
    const t0 = Date.now()
    for (let i = 1; i <= 10; i++) await capture(h, `shot ${i}`)
    const accepted = Date.now() - t0
    expect(accepted).toBeLessThan(40 * 10) // far less than processing them one by one
    expect(h.committed.length).toBeLessThan(10) // processing was still going on
    await h.queue.whenIdle()
    expect(h.committed).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
})

describe('sequential processing and order', () => {
  it('continues accepting captures after a screenshot could not be saved', async () => {
    const h = make()
    const writeImage = h.store.writeImage.bind(h.store)
    h.store.writeImage = async (id, png) => {
      if (png.equals(pngOf('broken'))) throw new Error('disk write failed')
      return writeImage(id, png)
    }
    await expect(capture(h, 'broken')).rejects.toThrow('disk write failed')
    await capture(h, 'next')
    await h.queue.whenIdle()
    expect(h.notes.get('A')).toEqual(['next'])
  })

  it('does not let a later capture overtake an earlier screenshot still being saved', async () => {
    const h = make({ settings: { maxConcurrent: 3 } })
    const writeImage = h.store.writeImage.bind(h.store)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    h.store.writeImage = async (id, png) => {
      if (png.equals(pngOf('first'))) await gate
      return writeImage(id, png)
    }
    const first = capture(h, 'first')
    const second = capture(h, 'second')
    const third = capture(h, 'third')
    await wait(60)
    const early = [...h.committed]
    release()
    await Promise.all([first, second, third])
    await h.queue.whenIdle()
    expect(early).toEqual([])
    expect(h.notes.get('A')).toEqual(['first', 'second', 'third'])
  })

  it('one worker by default: recognitions never overlap and run in capture order', async () => {
    const h = make()
    h.script = () => wait(5)
    for (let i = 1; i <= 8; i++) await capture(h, `s${i}`)
    await h.queue.whenIdle()
    expect(h.maxInFlight).toBe(1)
    expect(h.recognizeStarts).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('assigns increasing capture numbers, also for captures taken in the same instant', async () => {
    const h = make()
    h.settings.enabled = false // keep them queued
    const jobs = await Promise.all(Array.from({ length: 12 }, (_, i) => capture(h, `s${i}`)))
    const numbers = jobs.map((j) => j.sequenceNumber)
    expect(new Set(numbers).size).toBe(12)
    expect([...numbers].sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
  })

  it('numbers keep growing after a restart (never reused)', async () => {
    const first = make()
    first.settings.enabled = false
    await capture(first, 'a')
    await capture(first, 'b')
    const second = make({ dir: first.dir })
    second.settings.enabled = false
    const job = await capture(second, 'c')
    expect(job.sequenceNumber).toBe(3)
  })

  it('results that finish out of order are still written in capture order (3 workers)', async () => {
    const h = make({ settings: { maxConcurrent: 3 } })
    // #1 takes 80 ms, #2 only 5 ms, #3 takes 30 ms
    const delays: Record<number, number> = { 1: 80, 2: 5, 3: 30, 4: 5, 5: 60, 6: 5 }
    const finishedOrder: number[] = []
    h.script = async (seq) => {
      await wait(delays[seq] ?? 5)
      finishedOrder.push(seq)
    }
    for (let i = 1; i <= 6; i++) await capture(h, `s${i}`)
    await h.queue.whenIdle()
    expect(h.maxInFlight).toBeGreaterThan(1)
    expect(finishedOrder).not.toEqual([1, 2, 3, 4, 5, 6]) // the AI really answered out of order
    expect(h.committed).toEqual([1, 2, 3, 4, 5, 6])
    expect(h.notes.get('A')).toEqual(['s1', 's2', 's3', 's4', 's5', 's6'])
  })

  it('a recognized job waits (READY) until the earlier capture of its note is written', async () => {
    const h = make({ settings: { maxConcurrent: 2 } })
    let release: () => void = () => undefined
    h.script = (seq) => (seq === 1 ? new Promise<void>((r) => (release = r)) : undefined)
    await capture(h, 'first')
    await capture(h, 'second')
    await wait(30)
    expect(h.queue.getQueueState().buffered).toBe(1)
    expect(h.committed).toEqual([]) // #2 is ready but must not jump the line
    release()
    await h.queue.whenIdle()
    expect(h.committed).toEqual([1, 2])
  })

  it('different notes do not wait for each other', async () => {
    const h = make({ settings: { maxConcurrent: 2 } })
    let release: () => void = () => undefined
    h.script = (seq) => (seq === 1 ? new Promise<void>((r) => (release = r)) : undefined)
    await capture(h, 'slow', 'A')
    await capture(h, 'fast', 'B')
    await wait(30)
    expect(h.committed).toEqual([2]) // note B is written while note A still waits
    release()
    await h.queue.whenIdle()
    expect(h.committed).toEqual([2, 1])
  })

  it('committableJobs releases strictly in capture order per note', () => {
    const job = (sequenceNumber: number, status: OcrJob['status'], targetNoteId = 'A', extra: Partial<OcrJob> = {}): OcrJob =>
      ({ id: `j${sequenceNumber}`, sequenceNumber, status, targetNoteId, ...extra }) as OcrJob
    const ids = (jobs: OcrJob[]): number[] => committableJobs(jobs).map((j) => j.sequenceNumber)
    expect(ids([job(1, 'READY'), job(2, 'READY'), job(3, 'PROCESSING'), job(4, 'READY')])).toEqual([1, 2])
    expect(ids([job(1, 'PROCESSING'), job(2, 'READY')])).toEqual([])
    expect(ids([job(1, 'FAILED'), job(2, 'READY')])).toEqual([1, 2])
    expect(ids([job(1, 'FAILED', 'A', { placeholderWritten: true }), job(2, 'READY')])).toEqual([2])
    expect(ids([job(1, 'CANCELLED'), job(2, 'READY')])).toEqual([2])
    expect(ids([job(1, 'QUEUED', 'A'), job(2, 'READY', 'B')])).toEqual([2])
    expect(ids([job(1, 'QUEUED', 'A'), job(2, 'READY', 'A', { replacesSource: true })])).toEqual([2])
  })
})

describe('target note', () => {
  it('is fixed when the capture is taken: text goes to that note whatever happens later', async () => {
    const h = make()
    h.script = () => wait(20)
    await capture(h, 'for A', 'A')
    await capture(h, 'for B', 'B')
    await capture(h, 'more for A', 'A')
    await h.queue.whenIdle()
    expect(h.notes.get('A')).toEqual(['for A', 'more for A'])
    expect(h.notes.get('B')).toEqual(['for B'])
  })

  it('a note deleted while its captures wait: nothing is written, recognized data is discarded', async () => {
    const h = make()
    h.script = () => wait(20)
    await capture(h, 'one', 'A')
    await capture(h, 'two', 'A')
    h.existingNotes.delete('A')
    await h.queue.whenIdle()
    expect(h.committed).toEqual([])
    expect(h.queue.getQueueState().active).toBe(0)
    expect(h.files().filter((f) => f !== 'state.json')).toEqual([]) // temp files are gone too
  })
})

describe('retries and failures', () => {
  it('a rate-limited (429) job is retried after a pause and then succeeds', async () => {
    const h = make()
    h.script = (seq, attempt) => {
      if (seq === 1 && attempt < 2) throw new Error('429 Too Many Requests')
    }
    await capture(h, 'limited')
    await h.queue.whenIdle()
    expect(h.committed).toEqual([1])
    expect(h.sleeps).toEqual([3000, 10_000]) // two pauses before the third attempt
    expect(h.placeholders).toEqual([])
  })

  it('one failed job does not block the queue: it gets a placeholder in its place', async () => {
    const h = make()
    h.script = async (seq) => {
      await wait(15)
      if (seq === 2) throw new Error('all providers failed')
    }
    for (let i = 1; i <= 4; i++) await capture(h, `s${i}`)
    await h.queue.whenIdle()
    expect(h.notes.get('A')).toEqual(['s1', '⚠ #2', 's3', 's4'])
    expect(h.queue.getQueueState().failed).toBe(1)
    expect(h.finished.at(-1)).toMatchObject({ total: 4, done: 3, failed: 1 })
  })

  it('"Retry" on the failed job replaces its placeholder in the same position', async () => {
    const h = make()
    let fail = true
    h.script = (seq) => {
      if (seq === 2 && fail) throw new Error('boom')
    }
    for (let i = 1; i <= 3; i++) await capture(h, `s${i}`)
    await h.queue.whenIdle()
    const failed = h.queue.listJobs().find((j) => j.status === 'FAILED')!
    fail = false
    expect(await h.queue.retry(failed.id)).toBe(true)
    await h.queue.whenIdle()
    expect(h.replaced).toEqual([2])
    expect(h.notes.get('A')).toEqual(['s1', 's2', 's3'])
    expect(h.queue.getQueueState().failed).toBe(0)
  })

  it('a screenshot with no text writes nothing', async () => {
    const h = make()
    h.script = () => wait(15)
    await capture(h, '')
    await capture(h, 'text')
    await h.queue.whenIdle()
    expect(h.emptied).toEqual([1])
    expect(h.notes.get('A')).toEqual(['text'])
    expect(h.finished.at(-1)).toMatchObject({ total: 2, done: 1, empty: 1 })
  })
})

describe('persistence and restart', () => {
  it('captures that were waiting when the app stopped are recognized after the restart, exactly once', async () => {
    const before = make()
    // The first process gets through #1–#2 and "crashes" while #3 is being recognized.
    before.script = (seq) => (seq >= 3 ? new Promise<void>(() => undefined) : undefined)
    for (let i = 1; i <= 8; i++) await capture(before, `s${i}`)
    await wait(60)
    expect(before.committed).toEqual([1, 2])
    expect(before.files().filter((f) => f.endsWith('.json') && f !== 'state.json')).toHaveLength(6) // #3 … #8 survive on disk

    const after = make({ dir: before.dir })
    after.existingNotes = before.existingNotes
    expect(await after.queue.recoverPendingJobs()).toBe(6)
    await after.queue.whenIdle()
    expect(after.committed).toEqual([3, 4, 5, 6, 7, 8])
    expect([...before.committed, ...after.committed]).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(after.recognizeStarts.filter((s) => s === 3)).toHaveLength(1) // the interrupted job ran again, once
  })

  it('a job that was already recognized (READY) before the stop only needs to be written', async () => {
    const before = make({ settings: { maxConcurrent: 2 } })
    let release: () => void = () => undefined
    before.script = (seq) => (seq === 1 ? new Promise<void>((r) => (release = r)) : undefined)
    await capture(before, 'first')
    await capture(before, 'second')
    await wait(30) // #2 is READY, waiting for #1
    expect(before.queue.getQueueState().buffered).toBe(1)
    void release // the first process dies without #1 finishing

    const after = make({ dir: before.dir, settings: { maxConcurrent: 2 } })
    await after.queue.recoverPendingJobs()
    await after.queue.whenIdle()
    expect(after.committed).toEqual([1, 2])
    expect(after.recognizeStarts).toEqual([1]) // #2 was not recognized a second time
  })

  it('cleans up: nothing stays on disk after everything was written', async () => {
    const h = make()
    for (let i = 1; i <= 5; i++) await capture(h, `s${i}`)
    await h.queue.whenIdle()
    expect(h.files().filter((f) => f !== 'state.json')).toEqual([])
  })

  it('failed jobs keep their screenshot for a retry, cancel removes it, stale ones expire', async () => {
    const h = make()
    h.script = () => {
      throw new Error('nope')
    }
    const a = await capture(h, 'a')
    const b = await capture(h, 'b')
    await h.queue.whenIdle()
    expect(h.files().filter((f) => f.endsWith('.png'))).toHaveLength(2)
    expect(await h.queue.cancel(a.id)).toBe(true)
    expect(h.files().filter((f) => f.endsWith('.png'))).toHaveLength(1)

    // stale failed jobs are purged by age
    const old = make({ dir: h.dir })
    const jobs = await old.store.loadAll()
    jobs[0].updatedAt = Date.now() - 8 * 24 * 60 * 60 * 1000
    await old.store.save(jobs[0])
    await old.queue.recoverPendingJobs()
    expect(old.files().filter((f) => f.endsWith('.png'))).toHaveLength(0)
    expect(b.id).toBeTruthy()
  })

  it('orphan screenshots (crash between the two writes) are removed', async () => {
    const h = make()
    await h.store.writeImage('orphan1', pngOf('x'))
    expect(await h.store.cleanOrphans()).toBe(1)
    expect(h.files().includes('orphan1.png')).toBe(false)
  })
})

describe('control', () => {
  it('cancels a queued job and one that is being recognized', async () => {
    const h = make()
    let release: () => void = () => undefined
    h.script = (seq) => (seq === 1 ? new Promise<void>((r) => (release = r)) : undefined)
    const first = await capture(h, 'one')
    const second = await capture(h, 'two')
    await capture(h, 'three')
    await wait(20)
    expect(await h.queue.cancel(second.id)).toBe(true) // queued
    expect(await h.queue.cancel(first.id)).toBe(true) // processing
    release()
    await h.queue.whenIdle()
    expect(h.notes.get('A')).toEqual(['three'])
    expect(h.discarded).toEqual([1]) // what recognition stored for the cancelled job is removed
  })

  it('background processing can be switched off: captures are kept, not processed', async () => {
    const h = make()
    h.settings.enabled = false
    await capture(h, 'one')
    await capture(h, 'two')
    await wait(30)
    expect(h.committed).toEqual([])
    expect(h.queue.getQueueState().queued).toBe(2)
    h.settings.enabled = true
    h.queue.setPaused(false)
    await h.queue.whenIdle()
    expect(h.committed).toEqual([1, 2])
  })

  it('reports queue progress and one summary for the whole run', async () => {
    const h = make()
    h.script = () => wait(40)
    for (let i = 1; i <= 5; i++) await capture(h, `s${i}`)
    expect(h.queue.getQueueState().active).toBeGreaterThanOrEqual(4)
    await h.queue.whenIdle()
    expect(h.queue.getQueueState().active).toBe(0)
    // captures close together are one run: the last summary covers all of them
    expect(h.finished.at(-1)).toMatchObject({ total: 5, done: 5, failed: 0, empty: 0, noteIds: ['A'], lastNoteId: 'A' })
    expect(Math.max(...h.states.map((s) => s.active))).toBe(5)
  })
})

describe('acceptance: 20 rapid captures', () => {
  for (const workers of [1, 3]) {
    it(`20 captures taken faster than the AI answers → exactly 20 results, in order, no gaps or duplicates (${workers} worker${workers > 1 ? 's' : ''})`, async () => {
      const h = make({ settings: { maxConcurrent: workers } })
      // The AI is slow and uneven: 10–60 ms per screenshot, so many are still waiting when the last is taken.
      h.script = (seq) => wait(10 + ((seq * 37) % 50))
      const accepted: number[] = []
      for (let i = 1; i <= 20; i++) {
        const job = await capture(h, `Фрагмент ${i}`)
        accepted.push(job.sequenceNumber)
      }
      expect(accepted).toEqual(Array.from({ length: 20 }, (_, i) => i + 1)) // every capture accepted, numbered 1…20
      expect(h.committed.length).toBeLessThan(20) // taken before processing finished
      await h.queue.whenIdle()
      expect(h.notes.get('A')).toEqual(Array.from({ length: 20 }, (_, i) => `Фрагмент ${i + 1}`))
      expect(new Set(h.committed).size).toBe(20)
      expect(h.queue.getQueueState().active).toBe(0)
      expect(h.files().filter((f) => f !== 'state.json')).toEqual([])
    })
  }

  it('20 captures with a restart in the middle: still exactly 20, in order, once each', async () => {
    const before = make()
    before.script = (seq) => (seq > 7 ? new Promise<void>(() => undefined) : wait(5))
    for (let i = 1; i <= 20; i++) await capture(before, `Фрагмент ${i}`)
    await wait(120)
    const after = make({ dir: before.dir })
    after.existingNotes = before.existingNotes
    after.notes = before.notes // the same note store
    await after.queue.recoverPendingJobs()
    await after.queue.whenIdle()
    expect(before.notes.get('A')).toEqual(Array.from({ length: 20 }, (_, i) => `Фрагмент ${i + 1}`))
  })
})
