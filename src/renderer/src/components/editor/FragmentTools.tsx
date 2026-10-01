import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { OcrSource } from '@shared/blocks'
import { useAppStore } from '../../store/useAppStore'
import { Button, Menu, MenuItem, MenuLabel, MenuSeparator, Modal, Popover, Spinner, cn } from '../../ui'
import { CopyIcon, EyeIcon, InfoIcon, ScanTextIcon, SparkleIcon, TrashIcon, MoreIcon } from '../icons'
import { sanitizeHtmlForDisplay } from '../../utils/sanitizeHtml'
import { sourceOfBlock, topLevelBlock } from './caret'

type AiAction = 'shorten' | 'explain' | 'rewrite' | 'translate' | 'list' | 'keypoints'

interface Props {
  root: HTMLDivElement | null
  wrapper: HTMLDivElement | null
  noteId: string
  sources: Record<string, OcrSource>
  /** Saves pending editor changes before the main process rewrites the note. */
  flush: () => Promise<void>
  /** Re-reads the editor DOM after a local change. */
  onChange: () => void
}

interface Hovered {
  sourceId: string
  top: number
  height: number
}

export function originalSrc(noteId: string, source: OcrSource | undefined): string | null {
  return source?.imageId ? `snap-media://${noteId}/${source.imageId}.png` : null
}

function fragmentElements(root: HTMLElement, sourceId: string): HTMLElement[] {
  return Array.from(root.children).filter((el) => sourceOfBlock(el) === sourceId) as HTMLElement[]
}

function fragmentText(root: HTMLElement, sourceId: string): string {
  return fragmentElements(root, sourceId)
    .map((el) => el.innerText.trim())
    .filter(Boolean)
    .join('\n\n')
}

function translationTarget(text: string): { lang: string; label: string } {
  const cyrillic = (text.match(/[а-яё]/gi) ?? []).length
  const latin = (text.match(/[a-z]/gi) ?? []).length
  return cyrillic >= latin ? { lang: 'английский', label: 'Перевести на английский' } : { lang: 'русский', label: 'Перевести на русский' }
}

const AI_ITEMS: { action: AiAction; label: string }[] = [
  { action: 'shorten', label: 'Сократить' },
  { action: 'explain', label: 'Объяснить' },
  { action: 'rewrite', label: 'Переписать' },
  { action: 'list', label: 'Сделать список' },
  { action: 'keypoints', label: 'Выделить главное' }
]

/** Hover affordance + menu for text that came from a screen capture. */
export default function FragmentTools({ root, wrapper, noteId, sources, flush, onChange }: Props): ReactElement | null {
  const aiMode = useAppStore((s) => s.settings?.ai.mode)
  const pushToast = useAppStore((s) => s.pushToast)
  const [hovered, setHovered] = useState<Hovered | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [infoFor, setInfoFor] = useState<string | null>(null)
  const [reviewFor, setReviewFor] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const locked = menuOpen || busy || preview !== null

  const measure = useCallback(
    (sourceId: string): Hovered | null => {
      if (!root || !wrapper) return null
      const elements = fragmentElements(root, sourceId)
      if (elements.length === 0) return null
      const base = wrapper.getBoundingClientRect().top
      const first = elements[0].getBoundingClientRect()
      const last = elements[elements.length - 1].getBoundingClientRect()
      return { sourceId, top: first.top - base, height: last.bottom - first.top }
    },
    [root, wrapper]
  )

  useEffect(() => {
    if (!root) return undefined
    const onMove = (e: MouseEvent): void => {
      if (locked) return
      const block = topLevelBlock(root, e.target as Node)
      const sourceId = block ? sourceOfBlock(block) : null
      if (hideTimer.current) clearTimeout(hideTimer.current)
      if (sourceId && sources[sourceId] !== undefined) {
        setHovered(measure(sourceId))
      } else {
        hideTimer.current = setTimeout(() => setHovered(null), 250)
      }
    }
    const onLeave = (): void => {
      if (locked) return
      hideTimer.current = setTimeout(() => setHovered(null), 400)
    }
    root.addEventListener('mousemove', onMove)
    root.addEventListener('mouseleave', onLeave)
    return () => {
      root.removeEventListener('mousemove', onMove)
      root.removeEventListener('mouseleave', onLeave)
    }
  }, [root, sources, measure, locked])

  if (!hovered || !root) return null
  const { sourceId } = hovered
  const source = sources[sourceId]
  const imageUrl = originalSrc(noteId, source)
  const offline = aiMode === 'offline'
  const translate = translationTarget(fragmentText(root, sourceId))

  const run = async (label: string, task: () => Promise<{ ok: boolean; message?: string; provider?: string }>): Promise<void> => {
    setBusy(true)
    try {
      await flush()
      const result = await task()
      if (result.ok) pushToast('success', result.provider ? `${label}: готово (${result.provider})` : `${label}: готово`)
      else pushToast('error', result.message ?? `${label}: не удалось`)
    } finally {
      setBusy(false)
      setHovered(null)
    }
  }

  return (
    <>
      {/* Subtle margin line marking the whole fragment. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-3 w-[2px] rounded-full bg-accent opacity-50"
        style={{ top: hovered.top, height: hovered.height }}
      />
      <button
        ref={setAnchor}
        type="button"
        aria-label="Действия с распознанным фрагментом"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onMouseEnter={() => hideTimer.current && clearTimeout(hideTimer.current)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setMenuOpen((v) => !v)}
        className={cn(
          'absolute -right-2 flex h-6 w-6 items-center justify-center rounded-md border border-line bg-elevated text-fg-secondary shadow-popover transition-colors duration-fast hover:text-fg',
          menuOpen && 'text-accent'
        )}
        style={{ top: hovered.top }}
      >
        {busy ? <Spinner className="h-3 w-3" /> : <MoreIcon className="h-3.5 w-3.5" />}
      </button>

      <Menu open={menuOpen} onClose={() => setMenuOpen(false)} anchor={anchor} placement="bottom-end" aria-label="Распознанный фрагмент">
        <MenuLabel>Распознано с экрана</MenuLabel>
        <MenuItem icon={<EyeIcon />} disabled={!imageUrl} onSelect={() => setPreview(sourceId)}>
          Показать оригинал
        </MenuItem>
        <MenuItem icon={<ScanTextIcon />} disabled={!imageUrl} onSelect={() => setReviewFor(sourceId)}>
          Проверить распознавание
        </MenuItem>
        <MenuItem icon={<InfoIcon />} onSelect={() => setInfoFor(sourceId)}>
          Источник
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          icon={<SparkleIcon />}
          hint={offline ? 'офлайн' : undefined}
          onSelect={() => void run('Приведено в порядок', () => window.api.notes.tidySource(noteId, sourceId))}
        >
          Привести в порядок
        </MenuItem>
        <MenuLabel>ИИ{offline ? ' — недоступно в режиме «Только офлайн»' : ''}</MenuLabel>
        {AI_ITEMS.map((item) => (
          <MenuItem
            key={item.action}
            disabled={offline}
            onSelect={() => void run(item.label, () => window.api.notes.aiAction(noteId, sourceId, item.action))}
          >
            {item.label}
          </MenuItem>
        ))}
        <MenuItem
          disabled={offline}
          onSelect={() => void run(translate.label, () => window.api.notes.aiAction(noteId, sourceId, 'translate', translate.lang))}
        >
          {translate.label}
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          icon={<CopyIcon />}
          onSelect={() => {
            void navigator.clipboard.writeText(fragmentText(root, sourceId))
            pushToast('success', 'Фрагмент скопирован')
          }}
        >
          Копировать фрагмент
        </MenuItem>
        <MenuItem
          icon={<TrashIcon />}
          danger
          onSelect={() => void run('Фрагмент удалён', async () => ((await window.api.notes.removeSource(noteId, sourceId)) ? { ok: true } : { ok: false }))}
        >
          Удалить фрагмент
        </MenuItem>
      </Menu>

      <Popover
        open={preview !== null}
        onClose={() => {
          setPreview(null)
          setHovered(null)
        }}
        anchor={anchor}
        placement="left-start"
        className="max-w-[min(640px,80vw)] p-1.5"
        aria-label="Оригинал скриншота"
      >
        {imageUrl && <img src={imageUrl} alt="Оригинал" className="max-h-[70vh] w-auto rounded-xl" />}
      </Popover>

      <SourceInfoModal source={infoFor ? sources[infoFor] : undefined} onClose={() => setInfoFor(null)} />
      <ReviewModal
        open={reviewFor !== null}
        imageUrl={reviewFor ? originalSrc(noteId, sources[reviewFor]) : null}
        root={root}
        sourceId={reviewFor}
        onClose={() => setReviewFor(null)}
        onSaved={() => {
          setReviewFor(null)
          onChange()
          pushToast('success', 'Исправления сохранены')
        }}
      />
    </>
  )
}

const MODE_LABELS: Record<string, string> = {
  best: 'Лучшее качество',
  balanced: 'Сбалансированно',
  economy: 'Экономно',
  offline: 'Только офлайн'
}

/** OCR Block → Source Information (§17). */
function SourceInfoModal({ source, onClose }: { source: OcrSource | undefined; onClose: () => void }): ReactElement {
  const rows: [string, string | undefined][] = source
    ? [
        ['Приложение', source.appName],
        ['Окно', source.windowTitle],
        ['URL', source.url],
        ['Захвачено', source.capturedAt ? new Date(source.capturedAt).toLocaleString('ru-RU') : undefined],
        ['Распознавание', [source.method, source.model && source.model !== source.method?.toLowerCase() ? source.model : undefined].filter(Boolean).join(' · ') || undefined],
        ['Режим', source.mode ? (MODE_LABELS[source.mode] ?? source.mode) : undefined],
        ['Размер скриншота', source.imageWidth ? `${source.imageWidth} × ${source.imageHeight} px` : undefined]
      ]
    : []
  return (
    <Modal open={source !== undefined} onClose={onClose} title="Источник" size="md" footer={<Button onClick={onClose}>Закрыть</Button>}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-fg-secondary">{label}</dt>
              <dd className="min-w-0 break-words text-fg">{value}</dd>
            </div>
          ))}
      </dl>
      <p className="mt-3 text-sm text-fg-muted">Эти данные хранятся только на этом компьютере.</p>
    </Modal>
  )
}

/** "Проверить распознавание" (§19): original on the left, editable result on the right. */
function ReviewModal({
  open,
  imageUrl,
  root,
  sourceId,
  onClose,
  onSaved
}: {
  open: boolean
  imageUrl: string | null
  root: HTMLDivElement
  sourceId: string | null
  onClose: () => void
  onSaved: () => void
}): ReactElement {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const [initial, setInitial] = useState('')

  useEffect(() => {
    if (!open || !sourceId) return
    setInitial(fragmentElements(root, sourceId).map((el) => el.outerHTML).join(''))
  }, [open, sourceId, root])

  const attachEditor = useCallback(
    (el: HTMLDivElement | null) => {
      editorRef.current = el
      if (el && el.innerHTML === '') el.innerHTML = sanitizeHtmlForDisplay(initial)
    },
    [initial]
  )

  const save = (): void => {
    const editor = editorRef.current
    if (!editor || !sourceId) return
    const old = fragmentElements(root, sourceId)
    if (old.length === 0) return onClose()
    const parsed = document.createElement('div')
    parsed.innerHTML = sanitizeHtmlForDisplay(editor.innerHTML)
    const fragment = document.createDocumentFragment()
    for (const child of Array.from(parsed.childNodes)) {
      if (child instanceof HTMLElement) {
        // Keep every corrected block linked to the same capture.
        if (child.querySelector(':scope > img')) (child.querySelector(':scope > img') as HTMLElement).dataset.src = sourceId
        else child.dataset.src = sourceId
      } else if (!child.textContent?.trim()) {
        continue
      }
      fragment.appendChild(child)
    }
    old[0].before(fragment)
    for (const el of old) el.remove()
    onSaved()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Проверить распознавание"
      description="Слева — исходный скриншот, справа — распознанный текст. Исправьте ошибки и сохраните."
      size="lg"
      className="!max-w-[min(1100px,92vw)]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={save}>
            Сохранить исправления
          </Button>
        </>
      }
    >
      <div className="grid max-h-[65vh] grid-cols-2 gap-4">
        <div className="min-h-0 overflow-auto rounded-xl border border-line bg-surface-2 p-2">
          {imageUrl && <img src={imageUrl} alt="Исходный скриншот" className="w-full rounded-lg" />}
        </div>
        {open && (
          <div
            key={initial}
            ref={attachEditor}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Распознанный текст"
            className="rich-content min-h-0 overflow-auto rounded-xl border border-line p-3 text-fg outline-none focus:border-[var(--border-focus)]"
          />
        )}
      </div>
    </Modal>
  )
}
