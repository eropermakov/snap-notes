import type { ReactElement } from 'react'
import type { ThemeId } from '@shared/types'
import { ACCENT_OPTIONS, composeTheme, getThemeInfo } from '@shared/themes'
import { cn, SegmentedControl, SettingsRow } from '../ui'
import { CheckIcon, MoonIcon, SunIcon } from './icons'

interface Props {
  value: ThemeId
  onChange: (id: ThemeId) => void
}

/** Theme = neutral mode + accent. Rendered as two settings rows; place inside a SettingsGroup. */
export default function ThemePicker({ value, onChange }: Props): ReactElement {
  const current = getThemeInfo(value)
  return (
    <>
      <SettingsRow
        title="Оформление"
        control={
          <SegmentedControl
            aria-label="Оформление"
            value={current.mode}
            onChange={(mode) => onChange(composeTheme(current.color, mode))}
            options={[
              { value: 'light', label: 'Светлое', icon: <SunIcon className="h-3.5 w-3.5" /> },
              { value: 'dark', label: 'Тёмное', icon: <MoonIcon className="h-3.5 w-3.5" /> }
            ]}
          />
        }
      />
      <SettingsRow
        title="Акцентный цвет"
        description="Только для главных кнопок и активных переключателей."
        control={
          <div role="radiogroup" aria-label="Акцентный цвет" className="flex items-center gap-1.5">
            {ACCENT_OPTIONS.map((opt) => {
              const selected = opt.color === current.color
              return (
                <button
                  key={opt.color}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={opt.label}
                  title={opt.label}
                  onClick={() => onChange(composeTheme(opt.color, current.mode))}
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full transition-shadow duration-fast',
                    selected ? 'ring-2 ring-[var(--border-normal)] ring-offset-2 ring-offset-[var(--bg-primary)]' : 'hover:ring-2 hover:ring-[var(--border-subtle)]'
                  )}
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full text-white" style={{ background: opt.swatch }}>
                    {selected && <CheckIcon className="h-3 w-3" />}
                  </span>
                </button>
              )
            })}
          </div>
        }
      />
    </>
  )
}
