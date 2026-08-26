import type { ReactElement } from 'react'
import { motion } from 'framer-motion'
import { useAppStore } from '../store/useAppStore'
import { PlusIcon, ScanDocIcon } from './icons'

export default function Fab(): ReactElement {
  const createNote = useAppStore((s) => s.createNote)
  const notesCount = useAppStore((s) => s.notes.length)

  return (
    <>
      <motion.button
        onClick={() => void window.api.app.captureDocument()}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.92 }}
        className="absolute bottom-[6.5rem] right-9 flex h-11 w-11 items-center justify-center rounded-full border border-surface-border bg-surface text-muted shadow-card-hover transition-colors hover:border-accent hover:text-accent"
        title="Документ из скриншота: текст и фото по порядку"
      >
        <ScanDocIcon className="h-5 w-5" />
      </motion.button>

      <motion.button
        onClick={() => void createNote()}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        className={`absolute bottom-8 right-8 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-fab transition-colors hover:bg-accent-hover ${
          notesCount === 0 ? 'animate-pulse-fab' : ''
        }`}
        title="Новая заметка"
      >
        <PlusIcon className="h-6 w-6" />
      </motion.button>
    </>
  )
}
