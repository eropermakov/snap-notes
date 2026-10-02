/**
 * Pending-save hooks of everything that edits notes in this window (the note editor). When the app
 * is about to quit, or the window is closing, all of them are flushed before the process ends.
 */
const flushers = new Set<() => Promise<void>>()

export function registerFlush(fn: () => Promise<void>): () => void {
  flushers.add(fn)
  return () => {
    flushers.delete(fn)
  }
}

export async function flushAll(): Promise<void> {
  await Promise.all([...flushers].map((fn) => fn().catch(() => undefined)))
}
