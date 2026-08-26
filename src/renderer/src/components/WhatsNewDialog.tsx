import type { ReactElement } from 'react'
import { motion } from 'framer-motion'
import { CHANGELOG } from '@shared/changelog'
import { useAppStore } from '../store/useAppStore'
import { SparkleIcon } from './icons'

export default function WhatsNewDialog(): ReactElement {
  const dismissWhatsNew = useAppStore((s) => s.dismissWhatsNew)
  const latest = CHANGELOG[0]

  return (
    <motion.div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-ink/40 p-6 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => void dismissWhatsNew()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col rounded-2xl border border-surface-border bg-surface p-6 shadow-card-hover"
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-light text-accent">
            <SparkleIcon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-ink">Что нового в {latest.version}</h2>
            <p className="text-xs text-muted">{latest.date}</p>
          </div>
        </div>

        <ul className="mb-5 space-y-2 text-sm text-ink/90">
          {latest.items.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <button
          onClick={() => void dismissWhatsNew()}
          className="self-end rounded-full bg-accent px-5 py-2 text-sm font-medium text-white transition hover:bg-accent-hover active:scale-[0.97]"
        >
          Понятно
        </button>
      </motion.div>
    </motion.div>
  )
}
