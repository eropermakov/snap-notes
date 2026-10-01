import type { ReactElement } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAppStore } from '../store/useAppStore'
import { EASE_OUT } from '../ui'
import Toast from './Toast'

export default function ToastContainer(): ReactElement {
  const toasts = useAppStore((s) => s.toasts)
  const dismissToast = useAppStore((s) => s.dismissToast)

  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-5 right-5 z-[360] flex w-[360px] max-w-[calc(100vw-40px)] flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
            className="pointer-events-auto"
          >
            <Toast toast={t} onDismiss={() => dismissToast(t.id)} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
