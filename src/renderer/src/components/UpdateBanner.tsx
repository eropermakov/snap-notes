import type { ReactElement } from 'react'
import { motion } from 'framer-motion'
import { useAppStore } from '../store/useAppStore'
import { Button, EASE_OUT, IconButton, Spinner } from '../ui'
import { CloseIcon, RefreshIcon } from './icons'

/** Floating, dismissable notice. Only "update ready" gets a primary action. */
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
      role="status"
      initial={{ y: 12, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 8, opacity: 0 }}
      transition={{ duration: 0.2, ease: EASE_OUT }}
      className="fixed bottom-5 left-1/2 z-[340] flex w-[440px] max-w-[calc(100vw-40px)] -translate-x-1/2 items-center gap-3 rounded-2xl border border-line bg-elevated py-2.5 pl-4 pr-2 shadow-popover"
    >
      <span className="shrink-0 text-fg-secondary">{ready ? <RefreshIcon /> : <Spinner />}</span>
      <div className="min-w-0 flex-1">
        <p className="text-base font-medium text-fg">{ready ? `Обновление ${version} готово` : `Скачивается обновление ${version}`}</p>
        <p className="text-sm text-fg-secondary">{ready ? 'Перезапустите, чтобы установить' : 'Это займёт немного времени'}</p>
      </div>
      {ready && (
        <Button variant="primary" size="sm" onClick={installUpdate}>
          Перезапустить
        </Button>
      )}
      <IconButton size="sm" label="Позже" icon={<CloseIcon className="h-3.5 w-3.5" />} onClick={dismissUpdateBanner} />
    </motion.div>
  )
}
