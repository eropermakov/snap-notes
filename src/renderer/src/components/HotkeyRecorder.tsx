import { useEffect, useState, type ReactElement } from 'react'
import { cn, SettingsRow } from '../ui'
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

export function formatAccelerator(accelerator: string | undefined): string {
  // Optional hotkeys are stored as '' when off; never let a missing value break rendering.
  if (!accelerator) return 'Не назначено'
  return accelerator
    .split('+')
    .map((part) => (part === 'Control' ? 'Ctrl' : part === 'Super' ? 'Win' : part))
    .join(' + ')
}

interface FieldProps {
  value: string
  invalid?: boolean
  onChange: (accelerator: string) => void
  'aria-label': string
}

/** Click, press a combination, done. Escape cancels. */
export function HotkeyField({ value, invalid, onChange, ...aria }: FieldProps): ReactElement {
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
    <button
      type="button"
      onClick={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      aria-label={`${aria['aria-label']}: ${recording ? 'нажмите комбинацию' : formatAccelerator(value)}`}
      className={cn(
        'h-8 min-w-[168px] rounded-lg border px-3 text-center text-sm font-medium transition-colors duration-fast',
        recording
          ? 'border-[var(--border-focus)] bg-accent-soft text-accent'
          : invalid
            ? 'border-danger bg-surface-2 text-fg'
            : 'border-line bg-surface-2 text-fg hover:border-line-strong'
      )}
    >
      {recording ? 'Нажмите комбинацию…' : formatAccelerator(value) || 'Выключено'}
    </button>
  )
}

interface Props {
  label: string
  description?: string
  value: string
  error?: string
  onChange: (accelerator: string) => void
}

export default function HotkeyRecorder({ label, description, value, error, onChange }: Props): ReactElement {
  return (
    <SettingsRow
      title={label}
      description={description}
      error={error}
      control={<HotkeyField value={value} invalid={Boolean(error)} onChange={onChange} aria-label={label} />}
    />
  )
}
