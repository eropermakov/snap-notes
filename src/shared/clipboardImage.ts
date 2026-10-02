/**
 * Decides when a "recognize the clipboard image?" suggestion may appear. The clipboard is polled by
 * the caller; this class only compares fingerprints, so one image is offered at most once — also
 * after it was dismissed or recognized — and an image that was already there when the feature turned
 * on is never offered.
 */
export class ClipboardImageWatcher {
  private seen = new Set<string>()
  private primed = false

  constructor(
    /** Fingerprint of the image in the clipboard, or null when there is none. Must be cheap. */
    private readonly fingerprint: () => string | null,
    private readonly onNewImage: (key: string) => void,
    private readonly maxRemembered = 30
  ) {}

  /** Call on a timer while the suggestion setting is on. */
  poll(): void {
    let key: string | null
    try {
      key = this.fingerprint()
    } catch {
      return
    }
    if (!this.primed) {
      this.primed = true
      if (key) this.remember(key)
      return
    }
    if (!key || this.seen.has(key)) return
    this.remember(key)
    this.onNewImage(key)
  }

  /** The user acted on an image (recognized it by command): never suggest it afterwards. */
  markHandled(key: string | null): void {
    if (key) this.remember(key)
  }

  /** Setting turned off/on: the next poll treats the current clipboard as already seen. */
  reset(): void {
    this.primed = false
  }

  private remember(key: string): void {
    this.seen.add(key)
    if (this.seen.size > this.maxRemembered) this.seen.delete(this.seen.values().next().value as string)
  }
}
