import type { ReactElement } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

interface Props {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Отмена',
  danger,
  onConfirm,
  onCancel
}: Props): ReactElement {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/30 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onCancel}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 8 }}
            transition={{ type: 'spring', stiffness: 340, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="mx-4 w-full max-w-sm rounded-2xl border border-surface-border bg-surface p-5 shadow-card-hover"
          >
            <h3 className="mb-1.5 text-base font-semibold text-ink">{title}</h3>
            <p className="mb-5 text-sm text-muted">{description}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={onCancel}
                className="rounded-full px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-bg"
              >
                {cancelLabel}
              </button>
              <button
                onClick={onConfirm}
                className={`rounded-full px-4 py-2 text-sm font-medium text-white transition-colors ${
                  danger ? 'bg-danger hover:bg-red-600' : 'bg-accent hover:bg-accent-hover'
                }`}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
