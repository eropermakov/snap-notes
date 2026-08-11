import { useEffect, useState, ReactElement } from 'react'
const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta'])

const NAMED_KEYS: Record<string, string> = {
  ' ': 'Space',
  Enter: 'Return',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown'
}

function keyToAcceleratorPart(key: string): string | null {
  if (key.length === 1) {
    const upper = key.toUpperCase()
    if (/[A-Z0-9]/.test(upper)) return upper
    const punctuation = "`-=[]\\;',./"
    if (punctuation.includes(key)) return key
    return null
  }
  if (NAMED_KEYS[key]) return NAMED_KEYS[key]
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return key
  return null
}

export function formatAccelerator(accelerator: string): string {
  return accelerator
    .split('+')
    .map((part) => (part === 'Control' ? 'Ctrl' : part === 'Super' ? 'Win' : part))
    .join(' + ')
}

interface Props {
  label: string
  value: string
  error?: string
  onChange: (accelerator: string) => void
}

export default function HotkeyRecorder({ label, value, error, onChange }: Props): ReactElement {
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    if (!recording) return undefined

    const handleKeyDown = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        setRecording(false)
        return
      }
      if (MODIFIER_KEYS.has(e.key)) return

      const parts: string[] = []
      if (e.ctrlKey) parts.push('Control')
      if (e.altKey) parts.push('Alt')
      if (e.shiftKey) parts.push('Shift')
      if (e.metaKey) parts.push('Super')
      if (parts.length === 0) return

      const mainKey = keyToAcceleratorPart(e.key)
      if (!mainKey) return

      parts.push(mainKey)
      onChange(parts.join('+'))
      setRecording(false)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [recording, onChange])

  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <p className="text-sm font-medium text-ink">{label}</p>
        {error && <p className="mt-0.5 text-xs text-danger">{error}</p>}
      </div>
      <button
        onClick={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        className={`min-w-[180px] rounded-lg border px-3 py-2 text-center font-mono text-sm transition-colors ${
          recording
            ? 'border-accent bg-accent-light text-accent'
            : error
              ? 'border-danger/60 bg-surface text-ink'
              : 'border-surface-border bg-surface text-ink hover:border-accent'
        }`}
      >
        {recording ? 'Нажмите комбинацию...' : formatAccelerator(value)}
      </button>
    </div>
  )
}
