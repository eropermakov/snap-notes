import type { ReactElement } from 'react'
import { useAppStore } from '../store/useAppStore'
import { SparkleIcon } from './icons'

interface Props {
  hasNotesAtAll: boolean
}

export default function EmptyState({ hasNotesAtAll }: Props): ReactElement {
  const settings = useAppStore((s) => s.settings)
  const region = settings?.hotkeys.region ?? 'Control+Shift+S'

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-accent-light text-accent">
        <SparkleIcon className="h-10 w-10" />
      </div>
      <h2 className="mb-2 text-lg font-semibold text-ink">
        {hasNotesAtAll ? 'Ничего не найдено' : 'Пока нет заметок'}
      </h2>
      <p className="max-w-sm text-sm text-muted">
        {hasNotesAtAll ? (
          'Попробуйте изменить запрос поиска.'
        ) : (
          <>
            Нажмите «+», чтобы создать заметку, или выделите текст на экране хоткеем{' '}
            <kbd className="rounded bg-accent-light px-1.5 py-0.5 font-mono text-xs text-accent">{region}</kbd> — он
            сам появится здесь.
          </>
        )}
      </p>
    </div>
  )
}
