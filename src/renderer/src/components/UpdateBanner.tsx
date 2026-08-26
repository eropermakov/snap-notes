import type { ReactElement } from 'react'
import { motion } from 'framer-motion'
import { useAppStore } from '../store/useAppStore'
import { SparkleIcon, CloseIcon } from './icons'

export default function UpdateBanner(): ReactElement | null {
  const updateAvailableVersion = useAppStore((s) => s.updateAvailableVersion)
  const updateReadyVersion = useAppStore((s) => s.updateReadyVersion)
  const installUpdate = useAppStore((s) => s.installUpdate)
  const dismissUpdateBanner = useAppStore((s) => s.dismissUpdateBanner)

  const ready = Boolean(updateReadyVersion)
  const version = updateReadyVersion ?? updateAvailableVersion
  if (!version) return null

  return (
    <motion.div
      initial={{ y: 60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 60, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      className="fixed bottom-6 left-1/2 z-[250] flex w-full max-w-md -translate-x-1/2 items-center gap-3 rounded-2xl border border-surface-border bg-surface p-4 shadow-card-hover"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-light text-accent">
        {ready ? (
          <SparkleIcon className="h-4 w-4" />
        ) : (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">
          {ready ? `Обновление ${version} готово` : `Скачивается обновление ${version}`}
        </p>
        <p className="text-xs text-muted">{ready ? 'Перезапустите, чтобы установить' : 'Это займёт немного времени'}</p>
      </div>
      {ready && (
        <button
          onClick={installUpdate}
          className="shrink-0 rounded-full bg-accent px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover active:scale-[0.97]"
        >
          Перезапустить
        </button>
      )}
      <button onClick={dismissUpdateBanner} className="shrink-0 text-muted transition hover:text-ink active:scale-[0.97]" title="Позже">
        <CloseIcon className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  )
}
