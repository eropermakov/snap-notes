import { useEffect, useState, type ReactElement } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { topLevelBlock } from './caret'

interface Props {
  root: HTMLDivElement | null
  wrapper: HTMLDivElement | null
}

interface Hovered {
  pre: HTMLPreElement
  top: number
}

/** Exact code text of a <pre>: no trailing newline, whitespace preserved. */
export function codeText(pre: HTMLElement): string {
  return (pre.textContent ?? '').replace(/ /g, ' ').replace(/\n$/, '')
}

function fence(code: string, language: string): string {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((m) => m.length))
  const ticks = '`'.repeat(Math.max(3, longest + 1))
  return `${ticks}${language}\n${code}\n${ticks}`
}

/** "Копировать код" / "Markdown" buttons on the code block under the pointer (§10). */
export default function CodeTools({ root, wrapper }: Props): ReactElement | null {
  const pushToast = useAppStore((s) => s.pushToast)
  const [hovered, setHovered] = useState<Hovered | null>(null)

  useEffect(() => {
    if (!root || !wrapper) return undefined
    const onMove = (e: MouseEvent): void => {
      const block = topLevelBlock(root, e.target as Node)
      if (block instanceof HTMLPreElement) {
        setHovered({ pre: block, top: block.getBoundingClientRect().top - wrapper.getBoundingClientRect().top })
      } else if (!(e.target as HTMLElement).closest?.('[data-code-tools]')) {
        setHovered(null)
      }
    }
    const onLeave = (e: MouseEvent): void => {
      // Moving onto the buttons themselves must not hide them.
      if ((e.relatedTarget as HTMLElement | null)?.closest?.('[data-code-tools]')) return
      setHovered(null)
    }
    root.addEventListener('mousemove', onMove)
    root.addEventListener('mouseleave', onLeave)
    return () => {
      root.removeEventListener('mousemove', onMove)
      root.removeEventListener('mouseleave', onLeave)
    }
  }, [root, wrapper])

  if (!hovered) return null
  const language = hovered.pre.dataset.lang ?? ''

  const copy = (markdown: boolean): void => {
    const code = codeText(hovered.pre)
    void navigator.clipboard.writeText(markdown ? fence(code, language) : code)
    pushToast('success', markdown ? 'Код скопирован как Markdown' : 'Код скопирован')
  }

  return (
    <div
      data-code-tools
      className="absolute right-1.5 z-[5] flex items-center gap-0.5 rounded-md border border-line bg-elevated p-0.5 shadow-popover"
      style={{ top: hovered.top + 6 }}
      onMouseLeave={(e) => {
        if (!root?.contains(e.relatedTarget as Node | null)) setHovered(null)
      }}
    >
      {language && <span className="px-1.5 text-xs text-fg-muted">{language}</span>}
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => copy(false)}
        className="h-6 rounded px-1.5 text-sm text-fg-secondary transition-colors duration-fast hover:bg-hover hover:text-fg"
      >
        Копировать код
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => copy(true)}
        className="h-6 rounded px-1.5 text-sm text-fg-secondary transition-colors duration-fast hover:bg-hover hover:text-fg"
      >
        Markdown
      </button>
    </div>
  )
}
