import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { contactHref, findContactAt, isOpenableLink, type Contact } from '@shared/textTools'
import { useAppStore } from '../../store/useAppStore'
import { Button } from '../../ui'
import { CopyIcon, ExternalLinkIcon, MailIcon, PhoneIcon } from '../icons'

interface Props {
  root: HTMLDivElement | null
  wrapper: HTMLDivElement | null
}

interface Hover {
  contact: Pick<Contact, 'kind' | 'value'>
  href: string
  left: number
  top: number
}

function pointToTextPosition(x: number, y: number): { node: Text; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const pos = doc.caretPositionFromPoint?.(x, y)
  if (pos && pos.offsetNode.nodeType === Node.TEXT_NODE) return { node: pos.offsetNode as Text, offset: pos.offset }
  const range = doc.caretRangeFromPoint?.(x, y)
  if (range && range.startContainer.nodeType === Node.TEXT_NODE) return { node: range.startContainer as Text, offset: range.startOffset }
  return null
}

/**
 * Links, e-mails and phone numbers in plain text. Hovering one shows a small bar with the right
 * actions; Ctrl+click opens it directly. Everything opens in the system's default app (browser, mail,
 * dialer) — never inside Snap Notes.
 */
export default function LinkTools({ root, wrapper }: Props): ReactElement | null {
  const pushToast = useAppStore((s) => s.pushToast)
  const [hover, setHover] = useState<Hover | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const frame = useRef(0)

  const open = useCallback(
    async (href: string, kind: Contact['kind']): Promise<void> => {
      if (!isOpenableLink(href)) return
      const result = await window.api.app.openLink(href)
      if (!result.ok) pushToast('warning', kind === 'phone' ? 'В системе нет приложения для звонков — номер можно скопировать.' : 'Не удалось открыть ссылку')
    },
    [pushToast]
  )

  useEffect(() => {
    if (!root || !wrapper) return undefined

    const resolve = (e: MouseEvent): { contact: Pick<Contact, 'kind' | 'value'>; href: string; rect: DOMRect } | null => {
      const target = e.target as HTMLElement
      if (target.closest('pre, [data-no-links]')) return null
      const anchor = target.closest('a[href]') as HTMLAnchorElement | null
      if (anchor && root.contains(anchor)) {
        const href = anchor.getAttribute('href') ?? ''
        const kind: Contact['kind'] = href.startsWith('mailto:') ? 'email' : href.startsWith('tel:') ? 'phone' : 'url'
        return { contact: { kind, value: anchor.textContent ?? href }, href, rect: anchor.getBoundingClientRect() }
      }
      const at = pointToTextPosition(e.clientX, e.clientY)
      if (!at || !root.contains(at.node)) return null
      const contact = findContactAt(at.node.data, at.offset)
      if (!contact) return null
      const range = document.createRange()
      range.setStart(at.node, contact.start)
      range.setEnd(at.node, contact.end)
      const rect = range.getBoundingClientRect()
      // The pointer must really be over the token, not just on the same line.
      if (e.clientX < rect.left - 2 || e.clientX > rect.right + 2 || e.clientY < rect.top - 2 || e.clientY > rect.bottom + 2) return null
      return { contact, href: contactHref(contact), rect }
    }

    const onMove = (e: MouseEvent): void => {
      cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(() => {
        const found = resolve(e)
        if (found) {
          if (hideTimer.current) clearTimeout(hideTimer.current)
          const base = wrapper.getBoundingClientRect()
          setHover({ contact: found.contact, href: found.href, left: found.rect.left - base.left, top: found.rect.bottom - base.top + 4 })
        } else if (!hideTimer.current) {
          hideTimer.current = setTimeout(() => {
            hideTimer.current = null
            setHover(null)
          }, 350)
        }
      })
    }
    const onClick = (e: MouseEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      const found = resolve(e)
      if (!found) return
      e.preventDefault()
      void open(found.href, found.contact.kind)
    }
    root.addEventListener('mousemove', onMove)
    root.addEventListener('click', onClick)
    return () => {
      cancelAnimationFrame(frame.current)
      root.removeEventListener('mousemove', onMove)
      root.removeEventListener('click', onClick)
    }
  }, [root, wrapper, open])

  if (!hover) return null
  const { contact, href } = hover
  const keepOpen = (): void => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = null
  }

  return (
    <div
      role="toolbar"
      aria-label="Действия со ссылкой"
      data-no-links
      className="absolute z-20 flex items-center gap-0.5 rounded-xl border border-[var(--border-card)] bg-elevated p-1 shadow-popover"
      style={{ left: Math.max(0, hover.left), top: hover.top }}
      onMouseEnter={keepOpen}
      onMouseLeave={() => setHover(null)}
      onMouseDown={(e) => e.preventDefault()}
    >
      {contact.kind === 'email' ? (
        <Button size="sm" variant="ghost" icon={<MailIcon />} onClick={() => void open(href, 'email')}>
          Написать
        </Button>
      ) : contact.kind === 'phone' ? (
        <Button size="sm" variant="ghost" icon={<PhoneIcon />} onClick={() => void open(href, 'phone')}>
          Позвонить
        </Button>
      ) : (
        <Button size="sm" variant="ghost" icon={<ExternalLinkIcon />} onClick={() => void open(href, 'url')}>
          Открыть в браузере
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        icon={<CopyIcon />}
        onClick={() => {
          void navigator.clipboard.writeText(contact.kind === 'url' ? href : contact.value)
          pushToast('success', 'Скопировано')
          setHover(null)
        }}
      >
        Копировать
      </Button>
      <span className="px-1.5 text-xs text-fg-muted">Ctrl+клик</span>
    </div>
  )
}
