import type { ReactElement } from 'react'
import type { ThemeId } from '@shared/types'
import { THEMES, type ThemeInfo } from '@shared/themes'

interface Props {
  value: ThemeId
  onChange: (id: ThemeId) => void
}

function Row({ themes, label, value, onChange }: { themes: ThemeInfo[]; label: string; value: ThemeId; onChange: (id: ThemeId) => void }): ReactElement {
  return (
    <div className="mb-3 last:mb-0">
      <p className="mb-1.5 text-xs font-medium text-muted">{label}</p>
      <div className="flex gap-2">
        {themes.map((theme) => (
          <button
            key={theme.id}
            onClick={() => onChange(theme.id)}
            title={theme.label}
            className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-transform hover:scale-105 ${
              value === theme.id ? 'border-ink' : 'border-transparent'
            }`}
          >
            <span className="h-7 w-7 rounded-full" style={{ background: theme.swatch }} />
          </button>
        ))}
      </div>
    </div>
  )
}

export default function ThemePicker({ value, onChange }: Props): ReactElement {
  const light = THEMES.filter((t) => t.mode === 'light')
  const dark = THEMES.filter((t) => t.mode === 'dark')

  return (
    <div>
      <Row themes={light} label="Светлая тема" value={value} onChange={onChange} />
      <Row themes={dark} label="Тёмная тема" value={value} onChange={onChange} />
    </div>
  )
}
