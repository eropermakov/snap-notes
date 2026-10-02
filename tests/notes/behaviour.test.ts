import { afterEach, describe, expect, it, vi } from 'vitest'
import { Autosaver } from '../../src/shared/autosave'
import { applySelection, EMPTY_SELECTION, pruneSelection } from '../../src/shared/selection'
import { resolveWindowState } from '../../src/shared/windowBounds'
import { validateCaptureRegion, type CaptureRegion, type DisplayInfo } from '../../src/shared/captureRegion'
import { ClipboardImageWatcher } from '../../src/shared/clipboardImage'
import { isDiscardableAutoNote, resolveStartupNote } from '../../src/shared/noteLifecycle'
import { collectImageIds, rewriteImageRefs } from '../../src/shared/imageRefs'
import { qualityFromLines, storedQuality } from '../../src/shared/ocrQuality'
import { countChars, countWords, noteStats, ocrProviderSummary, providerBadgeLabel } from '../../src/shared/noteStats'
import { findHotkeyConflicts, normalizeAccelerator } from '../../src/shared/hotkeyConflicts'
import { DEFAULT_HOTKEYS } from '../../src/shared/types'
import { note } from './helpers'

describe('autosave debounce', () => {
  afterEach(() => vi.useRealTimers())

  it('writes once, one second after the last change', async () => {
    vi.useFakeTimers()
    const save = vi.fn().mockResolvedValue(undefined)
    const states: string[] = []
    const saver = new Autosaver<string>({ save, onState: (s) => states.push(s) })
    saver.schedule('a')
    vi.advanceTimersByTime(600)
    saver.schedule('ab')
    vi.advanceTimersByTime(999)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('ab')
    expect(states).toEqual(['saving', 'saved'])
  })

  it('does not touch storage while nothing changes', async () => {
    vi.useFakeTimers()
    const save = vi.fn().mockResolvedValue(undefined)
    new Autosaver<string>({ save })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(save).not.toHaveBeenCalled()
  })

  it('flush writes a pending change immediately (closing, switching note, app exit)', async () => {
    vi.useFakeTimers()
    const save = vi.fn().mockResolvedValue(undefined)
    const saver = new Autosaver<string>({ save })
    saver.schedule('x')
    await saver.flush()
    expect(save).toHaveBeenCalledWith('x')
    expect(saver.hasPending()).toBe(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).toHaveBeenCalledTimes(1)
    await saver.flush()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('reports an error and retries the same change on the next flush', async () => {
    vi.useFakeTimers()
    const save = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
    const saver = new Autosaver<string>({ save })
    saver.schedule('keep me')
    await vi.advanceTimersByTimeAsync(1000)
    expect(saver.getState()).toBe('error')
    expect(saver.hasPending()).toBe(true)
    await saver.flush()
    expect(save).toHaveBeenLastCalledWith('keep me')
    expect(saver.getState()).toBe('saved')
  })

  it('a change made during a write is saved afterwards, not lost', async () => {
    vi.useFakeTimers()
    let release: () => void = () => undefined
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((r) => (release = r))).mockResolvedValue(undefined)
    const saver = new Autosaver<string>({ save })
    saver.schedule('one')
    await vi.advanceTimersByTimeAsync(1000)
    saver.schedule('two')
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(saver.getState()).toBe('saving')
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenLastCalledWith('two')
    expect(saver.getState()).toBe('saved')
  })
})

describe('multi-selection', () => {
  const order = ['a', 'b', 'c', 'd', 'e']

  it('plain click selects one note', () => {
    expect(applySelection(EMPTY_SELECTION, { order, id: 'b', ctrl: false, shift: false })).toEqual({ selected: ['b'], anchor: 'b' })
  })

  it('Ctrl+click toggles notes', () => {
    let s = applySelection(EMPTY_SELECTION, { order, id: 'b', ctrl: true, shift: false })
    s = applySelection(s, { order, id: 'd', ctrl: true, shift: false })
    expect(s.selected).toEqual(['b', 'd'])
    s = applySelection(s, { order, id: 'b', ctrl: true, shift: false })
    expect(s.selected).toEqual(['d'])
  })

  it('Shift+click selects the range from the anchor, in either direction', () => {
    let s = applySelection(EMPTY_SELECTION, { order, id: 'b', ctrl: true, shift: false })
    s = applySelection(s, { order, id: 'd', ctrl: false, shift: true })
    expect(s.selected).toEqual(['b', 'c', 'd'])
    s = applySelection(s, { order, id: 'a', ctrl: false, shift: true })
    expect(s.selected).toEqual(['a', 'b'])
  })

  it('Ctrl+Shift extends the existing selection', () => {
    let s = applySelection(EMPTY_SELECTION, { order, id: 'a', ctrl: true, shift: false })
    s = applySelection(s, { order, id: 'e', ctrl: false, shift: false })
    s = applySelection(s, { order, id: 'c', ctrl: true, shift: false })
    s = applySelection(s, { order, id: 'a', ctrl: true, shift: true })
    expect(new Set(s.selected)).toEqual(new Set(['e', 'c', 'b', 'a']))
  })

  it('drops notes that disappeared (bulk delete, filter change)', () => {
    const s = pruneSelection({ selected: ['a', 'b', 'c'], anchor: 'b' }, new Set(['a', 'c']))
    expect(s.selected).toEqual(['a', 'c'])
    expect(s.anchor).toBe('a')
  })
})

describe('window position validation', () => {
  const screens = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }]
  const defaults = { width: 1180, height: 760, minWidth: 760, minHeight: 520 }

  it('uses defaults without a saved state', () => {
    expect(resolveWindowState(null, screens, defaults)).toEqual({ bounds: { width: 1180, height: 760 }, maximized: false })
  })

  it('restores a window that is on a connected screen, including maximized state', () => {
    const r = resolveWindowState({ x: 100, y: 80, width: 1000, height: 700, maximized: true }, screens, defaults)
    expect(r).toEqual({ bounds: { x: 100, y: 80, width: 1000, height: 700 }, maximized: true })
  })

  it('moves a window whose monitor was disconnected onto the available screen', () => {
    const r = resolveWindowState({ x: 2500, y: 100, width: 1000, height: 700 }, screens, defaults)
    expect(r.bounds.x).toBeGreaterThanOrEqual(0)
    expect(r.bounds.x! + r.bounds.width).toBeLessThanOrEqual(1920)
    expect(r.bounds.y).toBeGreaterThanOrEqual(0)
  })

  it('keeps a window on a second monitor while it is connected', () => {
    const two = [...screens, { workArea: { x: 1920, y: 0, width: 1920, height: 1040 } }]
    const r = resolveWindowState({ x: 2500, y: 100, width: 1000, height: 700 }, two, defaults)
    expect(r.bounds).toEqual({ x: 2500, y: 100, width: 1000, height: 700 })
  })

  it('shrinks a window that no longer fits and ignores garbage', () => {
    const small = [{ workArea: { x: 0, y: 0, width: 1024, height: 600 } }]
    const r = resolveWindowState({ x: -4000, y: -4000, width: 1800, height: 1200 }, small, { ...defaults, minHeight: 300 })
    expect(r.bounds.width).toBe(1024)
    expect(r.bounds.height).toBe(600)
    expect(resolveWindowState({ x: NaN, y: 1, width: 800, height: 600 }, screens, defaults).bounds).toEqual({ width: 800, height: 600 })
    expect(resolveWindowState({ width: 'x' } as never, screens, defaults).bounds).toEqual({ width: 1180, height: 760 })
  })
})

describe('repeat last capture validation', () => {
  const display: DisplayInfo = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1.25 }
  const region: CaptureRegion = {
    displayId: 1,
    displayBounds: display.bounds,
    scaleFactor: 1.25,
    cropRect: { x: 100, y: 100, width: 400, height: 300 },
    imageSize: { width: 2400, height: 1350 },
    capturedAt: 1
  }

  it('repeats on the same monitor layout', () => {
    expect(validateCaptureRegion(region, [display])).toEqual({ ok: true, display })
  })

  it('refuses when nothing was captured yet', () => {
    expect(validateCaptureRegion(null, [display])).toEqual({ ok: false, reason: 'none' })
  })

  it('does not fail when the monitor is gone or the layout changed', () => {
    expect(validateCaptureRegion(region, [{ ...display, id: 2 }])).toEqual({ ok: false, reason: 'display_missing' })
    expect(validateCaptureRegion(region, [{ ...display, bounds: { ...display.bounds, width: 1280, height: 720 } }])).toEqual({ ok: false, reason: 'layout_changed' })
    expect(validateCaptureRegion(region, [{ ...display, scaleFactor: 1 }])).toEqual({ ok: false, reason: 'layout_changed' })
  })

  it('rejects rectangles outside the screenshot or malformed', () => {
    expect(validateCaptureRegion({ ...region, cropRect: { x: 2300, y: 0, width: 400, height: 100 } }, [display])).toEqual({ ok: false, reason: 'invalid' })
    expect(validateCaptureRegion({ ...region, cropRect: { x: 0, y: 0, width: 0, height: 10 } }, [display])).toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('clipboard image detection', () => {
  it('suggests a new image once, not the one already there, not the same one twice', () => {
    let current: string | null = 'old'
    const seen: string[] = []
    const watcher = new ClipboardImageWatcher(() => current, (key) => seen.push(key))
    watcher.poll() // primes: the image that was already in the clipboard
    watcher.poll()
    expect(seen).toEqual([])
    current = 'shot-1'
    watcher.poll()
    watcher.poll()
    watcher.poll()
    expect(seen).toEqual(['shot-1'])
    current = null
    watcher.poll()
    current = 'shot-1' // same picture copied again: still not offered again
    watcher.poll()
    current = 'shot-2'
    watcher.poll()
    expect(seen).toEqual(['shot-1', 'shot-2'])
  })

  it('never offers an image the user already recognized by command', () => {
    let current: string | null = null
    const seen: string[] = []
    const watcher = new ClipboardImageWatcher(() => current, (key) => seen.push(key))
    watcher.poll()
    watcher.markHandled('manual')
    current = 'manual'
    watcher.poll()
    expect(seen).toEqual([])
  })

  it('survives a failing clipboard read and treats the clipboard as seen after reset', () => {
    let boom = true
    let key: string | null = 'k'
    const seen: string[] = []
    const watcher = new ClipboardImageWatcher(() => {
      if (boom) throw new Error('locked')
      return key
    }, (k) => seen.push(k))
    expect(() => watcher.poll()).not.toThrow()
    boom = false
    watcher.poll()
    expect(seen).toEqual([])
    watcher.reset()
    key = 'later'
    watcher.poll()
    expect(seen).toEqual([])
  })
})

describe('last note restore', () => {
  const notes = [
    { id: 'a', deletedAt: null },
    { id: 'b', deletedAt: 123 }
  ]
  it('restores an existing note when the setting is on', () => {
    expect(resolveStartupNote(true, 'a', notes)).toBe('a')
  })
  it('opens the home screen when the note is deleted, trashed, unknown or the setting is off', () => {
    expect(resolveStartupNote(true, 'b', notes)).toBeNull()
    expect(resolveStartupNote(true, 'zzz', notes)).toBeNull()
    expect(resolveStartupNote(true, null, notes)).toBeNull()
    expect(resolveStartupNote(false, 'a', notes)).toBeNull()
  })
})

describe('auto-created empty notes', () => {
  it('discards only untouched auto-created notes', () => {
    expect(isDiscardableAutoNote(note({ autoCreated: true }))).toBe(true)
    expect(isDiscardableAutoNote(note({ autoCreated: true, body: '<p><br></p>' }))).toBe(true)
  })
  it('keeps notes the user created, typed in, titled, or that hold OCR/images', () => {
    expect(isDiscardableAutoNote(note({}))).toBe(false)
    expect(isDiscardableAutoNote(note({ autoCreated: true, body: '<p>hi</p>' }))).toBe(false)
    expect(isDiscardableAutoNote(note({ autoCreated: true, title: 'Мой заголовок', titleManual: true }))).toBe(false)
    // a title the app made from recognized text is not the user's work
    expect(isDiscardableAutoNote(note({ autoCreated: true, title: 'Из распознанного текста' }))).toBe(true)
    expect(isDiscardableAutoNote(note({ autoCreated: true, body: '<p><img src="snap-media://a/b.png"></p>' }))).toBe(false)
    expect(isDiscardableAutoNote(note({ autoCreated: true, sources: { c1: { id: 'c1', capturedAt: 1 } } }))).toBe(false)
    expect(isDiscardableAutoNote(note({ autoCreated: true, deletedAt: 5 }))).toBe(false)
  })
})

describe('duplicate note: image references', () => {
  it('rewrites only the duplicated note\'s image references to the copies', () => {
    const html = '<p><img src="snap-media://old/aaa.png"></p><p><img src="snap-media://other/zzz.png"></p>'
    expect(collectImageIds(html, 'old')).toEqual(['aaa'])
    const out = rewriteImageRefs(html, 'old', 'new', new Map([['aaa', 'bbb']]))
    expect(out).toContain('snap-media://new/bbb.png')
    expect(out).toContain('snap-media://other/zzz.png')
    expect(out).not.toContain('snap-media://old/')
  })
})

describe('note statistics', () => {
  it('counts the user\'s text only: lists and tables included, markup excluded', () => {
    const html = '<h1>Заголовок</h1><p>Раз два <b>три</b></p><ul><li>четыре</li></ul><table><tr><td>пять</td><td>шесть</td></tr></table>'
    const stats = noteStats(html)
    expect(stats.words).toBe(7)
    expect(countWords('')).toBe(0)
    expect(countWords("it's well-known 42")).toBe(3)
    expect(countChars('a  b\n\nc')).toBe(5)
  })

  it('summarizes OCR providers without guessing', () => {
    const src = (method?: string) => ({ id: 'x', capturedAt: 1, method })
    expect(ocrProviderSummary(undefined)).toEqual({ label: null, mixed: false, count: 0 })
    expect(ocrProviderSummary({ a: src('Gemini'), b: src('Gemini') })).toEqual({ label: 'Gemini', mixed: false, count: 1 })
    expect(ocrProviderSummary({ a: src('Gemini'), b: src('Groq') }).mixed).toBe(true)
    expect(providerBadgeLabel('Tesseract')).toBe('Offline')
    expect(providerBadgeLabel(undefined)).toBeNull()
  })
})

describe('OCR quality', () => {
  const line = (confidence: number, text = 'строка текста', words?: { text: string; confidence: number }[]) => ({ text, confidence, words })

  it('is UNKNOWN without reported confidences (never invented, e.g. for cloud AI output)', () => {
    expect(qualityFromLines(undefined)).toBe('UNKNOWN')
    expect(qualityFromLines([])).toBe('UNKNOWN')
    expect(qualityFromLines([line(Number.NaN)])).toBe('UNKNOWN')
    expect(storedQuality('UNKNOWN')).toBeUndefined()
  })

  it('maps the reported confidence to HIGH / MEDIUM / LOW', () => {
    expect(qualityFromLines([line(96), line(92)])).toBe('HIGH')
    expect(qualityFromLines([line(75)])).toBe('MEDIUM')
    expect(qualityFromLines([line(40)])).toBe('LOW')
    expect(storedQuality('HIGH')).toBe('HIGH')
  })

  it('weights long lines more than short ones', () => {
    expect(qualityFromLines([line(95, 'очень длинная и уверенно распознанная строка'), line(30, 'ой')])).toBe('HIGH')
  })

  it('downgrades when many words have low confidence', () => {
    const words = ['а1', 'б2', 'в3', 'г4', 'д5', 'е6', 'ж7', 'з8', 'и9', 'к0'].map((text, i) => ({ text, confidence: i < 2 ? 40 : 95 }))
    expect(qualityFromLines([line(95, 'а1 б2 в3 г4 д5 е6 ж7 з8 и9 к0', words)])).toBe('MEDIUM')
  })
})

describe('hotkeys', () => {
  it('ships defaults without conflicts', () => {
    const kinds = Object.keys(DEFAULT_HOTKEYS) as (keyof typeof DEFAULT_HOTKEYS)[]
    expect(findHotkeyConflicts(DEFAULT_HOTKEYS, kinds)).toEqual({})
    for (const kind of ['quickNote', 'repeatCapture', 'ocrClipboard', 'globalSearch'] as const) expect(DEFAULT_HOTKEYS[kind]).toBeTruthy()
  })

  it('detects the same combination written differently, ignores empty (disabled) ones', () => {
    const hotkeys = { ...DEFAULT_HOTKEYS, quickNote: 'ctrl + alt + Q', ocrClipboard: 'Alt+Control+q', repeatCapture: '', globalSearch: '' }
    expect(normalizeAccelerator('ctrl + alt + Q')).toBe(normalizeAccelerator('Alt+Control+q'))
    expect(findHotkeyConflicts(hotkeys, Object.keys(hotkeys) as never)).toEqual({ quickNote: 'ocrClipboard', ocrClipboard: 'quickNote' })
  })
})
