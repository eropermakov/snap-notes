import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import type { HudState } from '@shared/hud'
import { Button, Spinner, cn } from '../../ui'
import { CheckIcon, AlertTriangleIcon, XCircleIcon, CloseIcon, ClipboardIcon } from '../icons'

/** A short, soft two-note chime (low volume) — the optional "sound" part of OCR completion feedback. */
function playSoftChime(): void {
  try {
    const ctx = new AudioContext()
    const now = ctx.currentTime
    for (const [i, freq] of [660, 880].entries()) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, now + i * 0.09)
      gain.gain.exponentialRampToValueAtTime(0.05, now + i * 0.09 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.09 + 0.16)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now + i * 0.09)
      osc.stop(now + i * 0.09 + 0.18)
    }
    setTimeout(() => void ctx.close(), 600)
  } catch {
    // No audio device: the visual notice is enough.
  }
}

function fragments(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return `${count} фрагмент`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} фрагмента`
  return `${count} фрагментов`
}

/**
 * The capture HUD (§13, §21): lives in its own always-on-top, non-focusable window over whatever
 * app the user works in. Shows progress, the result with Undo / Open, the Capture Session counter,
 * and the note picker. The window is sized to this content.
 */
export default function CaptureHud(): ReactElement {
  const [state, setState] = useState<HudState>({ kind: 'hidden' })
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Transparent window: only the card itself is visible.
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    void window.api.settings.get().then((s) => document.documentElement.setAttribute('data-theme', s.theme))
    const off = window.api.hud.onState((next) => {
      setState(next)
      if (next.kind === 'added' && next.sound) playSoftChime()
      // Theme may have changed since the HUD window was created.
      void window.api.settings.get().then((s) => document.documentElement.setAttribute('data-theme', s.theme))
    })
    window.api.hud.ready()
    return off
  }, [])

  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el) return undefined
    const report = (): void => {
      const rect = el.getBoundingClientRect()
      window.api.hud.action({ type: 'resize', width: Math.ceil(rect.width) + 16, height: Math.ceil(rect.height) + 16 })
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(el)
    return () => observer.disconnect()
  }, [state])

  if (state.kind === 'hidden') return <div />

  const session = 'session' in state ? state.session : undefined

  return (
    <div className="flex h-screen w-screen items-end justify-end p-2">
      <div
        ref={panelRef}
        role="status"
        aria-live="polite"
        onMouseEnter={() => window.api.hud.action({ type: 'hover', hovering: true })}
        onMouseLeave={() => window.api.hud.action({ type: 'hover', hovering: false })}
        className="w-[344px] rounded-2xl border border-line bg-elevated p-3 text-fg shadow-popover"
      >
        {state.kind === 'working' && (
          <div className="flex items-center gap-2.5 text-base">
            <Spinner className="h-4 w-4 text-accent" />
            <span className="min-w-0 flex-1">{state.text}</span>
          </div>
        )}

        {state.kind === 'added' && (
          <div>
            <div className="flex items-start gap-2.5">
              <span className={cn('mt-0.5 shrink-0', state.tone === 'success' ? 'text-success' : 'text-warning')}>
                {state.tone === 'success' ? <CheckIcon className="h-4 w-4" /> : <AlertTriangleIcon className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-base">
                  Добавлено в «<span className="font-medium">{state.noteTitle}</span>»
                </p>
                {state.detail && <p className="mt-0.5 line-clamp-2 text-sm text-fg-secondary">{state.detail}</p>}
              </div>
              <DismissButton />
            </div>
            <div className="mt-2.5 flex justify-end gap-1.5">
              {state.sourceId && (
                <Button size="sm" variant="ghost" onClick={() => window.api.hud.action({ type: 'undo', noteId: state.noteId, sourceId: state.sourceId! })}>
                  Отменить
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={() => window.api.hud.action({ type: 'open', noteId: state.noteId })}>
                Открыть заметку
              </Button>
            </div>
          </div>
        )}

        {state.kind === 'suggest' && (
          <div className="flex items-center gap-2.5">
            <span className="shrink-0 text-fg-secondary">
              <ClipboardIcon className="h-4 w-4" />
            </span>
            <p className="min-w-0 flex-1 text-base">{state.text}</p>
            <Button size="sm" variant="secondary" onClick={() => window.api.hud.action({ type: 'ocrClipboard' })}>
              Распознать
            </Button>
            <DismissButton />
          </div>
        )}

        {state.kind === 'message' && (
          <div className="flex items-start gap-2.5">
            <span className={cn('mt-0.5 shrink-0', state.tone === 'error' ? 'text-danger' : 'text-warning')}>
              {state.tone === 'error' ? <XCircleIcon className="h-4 w-4" /> : <AlertTriangleIcon className="h-4 w-4" />}
            </span>
            <p className="min-w-0 flex-1 text-base">{state.text}</p>
            <DismissButton />
          </div>
        )}

        {state.kind === 'pick' && (
          <div>
            <p className="mb-2 text-base font-medium">Куда добавить?</p>
            <div className="flex flex-col gap-0.5">
              <PickRow label="Новая заметка" primary onClick={() => window.api.hud.action({ type: 'pick', requestId: state.requestId, choice: 'new' })} />
              {state.notes.map((n) => (
                <PickRow key={n.id} label={n.title} onClick={() => window.api.hud.action({ type: 'pick', requestId: state.requestId, choice: n.id })} />
              ))}
            </div>
            <div className="mt-2 flex justify-end">
              <Button size="sm" variant="ghost" onClick={() => window.api.hud.action({ type: 'pick', requestId: state.requestId, choice: null })}>
                Отмена
              </Button>
            </div>
          </div>
        )}

        {session && (
          <div className={cn('flex items-center gap-2', state.kind !== 'session' && 'mt-3 border-t border-line pt-2.5')}>
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Сессия захвата</p>
              <p className="truncate text-sm text-fg-secondary">
                {fragments(session.count)} · «{session.noteTitle}»
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => window.api.hud.action({ type: 'sessionNext' })}>
              + Фрагмент
            </Button>
            <Button size="sm" variant="primary" onClick={() => window.api.hud.action({ type: 'sessionFinish' })}>
              Готово
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function DismissButton(): ReactElement {
  return (
    <button
      type="button"
      aria-label="Скрыть"
      onClick={() => window.api.hud.action({ type: 'dismiss' })}
      className="shrink-0 rounded-md p-0.5 text-fg-muted transition-colors duration-fast hover:bg-hover hover:text-fg"
    >
      <CloseIcon className="h-3.5 w-3.5" />
    </button>
  )
}

function PickRow({ label, onClick, primary }: { label: string; onClick: () => void; primary?: boolean }): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-8 truncate rounded-lg px-2 text-left text-base transition-colors duration-fast hover:bg-hover',
        primary ? 'font-medium text-accent' : 'text-fg'
      )}
    >
      {label}
    </button>
  )
}
