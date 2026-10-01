import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { OcrSource } from '@shared/blocks'
import { Button, Popover } from '../../ui'
import { AlertTriangleIcon } from '../icons'
import { sourceOfBlock, topLevelBlock } from './caret'
import { originalSrc } from './FragmentTools'

interface Props {
  root: HTMLDivElement | null
  noteId: string
  sources: Record<string, OcrSource>
  onChange: () => void
}

/**
 * Low-confidence OCR marks (§8): hovering a `span.ocr-uncertain` shows why it is marked and the
 * original screenshot, so the value can be checked; "Верно" removes the mark.
 */
export default function UncertainHover({ root, noteId, sources, onChange }: Props): ReactElement {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!root) return undefined
    const onOver = (e: MouseEvent): void => {
      const span = (e.target as HTMLElement).closest?.('span.ocr-uncertain') as HTMLElement | null
      if (!span || !root.contains(span)) return
      if (closeTimer.current) clearTimeout(closeTimer.current)
      setTarget(span)
    }
    const onOut = (e: MouseEvent): void => {
      const span = (e.target as HTMLElement).closest?.('span.ocr-uncertain')
      if (!span) return
      closeTimer.current = setTimeout(() => setTarget(null), 350)
    }
    root.addEventListener('mouseover', onOver)
    root.addEventListener('mouseout', onOut)
    return () => {
      root.removeEventListener('mouseover', onOver)
      root.removeEventListener('mouseout', onOut)
    }
  }, [root])

  const block = target && root ? topLevelBlock(root, target) : null
  const sourceId = block ? sourceOfBlock(block) : null
  const imageUrl = sourceId ? originalSrc(noteId, sources[sourceId]) : null

  const confirm = (): void => {
    if (!target) return
    // Unwrap: keep the text, drop the mark.
    const parent = target.parentNode
    while (target.firstChild) parent?.insertBefore(target.firstChild, target)
    target.remove()
    setTarget(null)
    onChange()
  }

  return (
    <Popover
      open={target !== null}
      onClose={() => setTarget(null)}
      anchor={target}
      placement="bottom-start"
      hoverCard
      restoreFocus={false}
      className="w-[300px] p-3"
      aria-label="Низкая уверенность распознавания"
    >
      <div onMouseEnter={() => closeTimer.current && clearTimeout(closeTimer.current)}>
        <p className="flex items-center gap-1.5 text-base font-medium text-fg">
          <AlertTriangleIcon className="h-4 w-4 text-warning" /> Низкая уверенность распознавания
        </p>
        <p className="mt-1 text-sm text-fg-secondary">
          Распознано как «<span className="font-medium text-fg">{target?.textContent}</span>». Сверьте с оригиналом.
        </p>
        {imageUrl && <img src={imageUrl} alt="Оригинал" className="mt-2 max-h-40 w-full rounded-lg border border-line object-contain" />}
        <div className="mt-2.5 flex justify-end">
          <Button size="sm" variant="secondary" onMouseDown={(e) => e.preventDefault()} onClick={confirm}>
            Верно
          </Button>
        </div>
      </div>
    </Popover>
  )
}
