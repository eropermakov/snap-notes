import { useEffect, useState, type ReactElement } from 'react'
import type { ProviderId } from '@shared/providers'
import type { RetryProvider, RetryResult } from '@shared/retry'
import { useAppStore } from '../../store/useAppStore'
import { Badge, Button, Modal, Spinner } from '../../ui'
import { RefreshIcon } from '../icons'

interface Props {
  open: boolean
  noteId: string
  sourceId: string | null
  /** Saves pending edits first: the main process rewrites the fragment. */
  flush: () => Promise<void>
  onClose: () => void
}

/**
 * "Retry with another AI": pick a vision / OCR source (or the next one automatically). The new text is
 * produced first and only shown; the current text stays untouched until the user presses Replace.
 */
export default function RetryModal({ open, noteId, sourceId, flush, onClose }: Props): ReactElement {
  const pushToast = useAppStore((s) => s.pushToast)
  const [providers, setProviders] = useState<RetryProvider[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<RetryResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !sourceId) return
    setResult(null)
    setError('')
    setProviders(null)
    void window.api.notes.retryProviders(noteId, sourceId).then(setProviders)
  }, [open, noteId, sourceId])

  const run = async (target: 'next' | ProviderId): Promise<void> => {
    if (!sourceId) return
    setBusy(target)
    setError('')
    try {
      await flush()
      const r = await window.api.notes.retrySource(noteId, sourceId, target)
      if (r.ok) setResult(r)
      else setError(r.message ?? 'Не удалось распознать')
    } finally {
      setBusy(null)
    }
  }

  const finish = async (apply: boolean): Promise<void> => {
    if (result?.token) {
      await window.api.notes.applyRetry(result.token, apply)
      if (apply) pushToast('success', `Заменено: ${result.providerName}`)
    }
    setResult(null)
    onClose()
  }

  const close = (): void => {
    if (result?.token) void window.api.notes.applyRetry(result.token, false)
    setResult(null)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      className={result ? '!max-w-[min(900px,92vw)]' : undefined}
      title={result ? `Сравнение: ${result.providerName}` : 'Повторить другим ИИ'}
      description={
        result
          ? 'Слева — текущий текст, справа — новый. Текущий текст не изменён, пока вы не нажмёте «Заменить».'
          : 'Тот же скриншот будет распознан другим источником. Текущий текст не пропадёт, пока вы не подтвердите замену.'
      }
      footer={
        result ? (
          <>
            <Button variant="ghost" onClick={() => void finish(false)}>
              Оставить текущий
            </Button>
            <Button variant="primary" onClick={() => void finish(true)}>
              Заменить
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={close}>
            Закрыть
          </Button>
        )
      }
    >
      {result ? (
        <div className="grid max-h-[55vh] grid-cols-2 gap-3">
          <TextColumn title="Сейчас" text={result.oldText ?? ''} />
          <TextColumn title={`${result.providerName}${result.model ? ` · ${result.model}` : ''}`} text={result.newText ?? ''} />
        </div>
      ) : (
        <div className="space-y-2">
          <Button
            variant="secondary"
            className="w-full justify-start"
            icon={busy === 'next' ? <Spinner /> : <RefreshIcon />}
            disabled={busy !== null}
            onClick={() => void run('next')}
          >
            Попробовать следующий источник автоматически
          </Button>
          <div className="pt-1 text-xs font-medium text-fg-muted">Или выберите источник</div>
          {providers === null && <p className="text-sm text-fg-muted">Загружаю список…</p>}
          {providers?.length === 0 && <p className="text-sm text-fg-muted">Нет доступных источников распознавания.</p>}
          {providers?.map((p) => (
            <Button
              key={p.id}
              variant="secondary"
              className="w-full justify-between"
              disabled={busy !== null}
              onClick={() => void run(p.id)}
              trailing={busy === p.id ? <Spinner /> : p.current ? <Badge>Сейчас</Badge> : p.local ? <Badge>Офлайн</Badge> : undefined}
            >
              {p.name}
            </Button>
          ))}
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      )}
    </Modal>
  )
}

function TextColumn({ title, text }: { title: string; text: string }): ReactElement {
  return (
    <div className="flex min-h-0 flex-col rounded-xl border border-line">
      <div className="border-b border-line px-3 py-2 text-xs font-medium text-fg-secondary">{title}</div>
      <pre className="selectable min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-sans text-sm text-fg">{text || '—'}</pre>
    </div>
  )
}
