import type { ReactElement } from 'react'
import { motion } from 'framer-motion'
import { useAppStore } from '../store/useAppStore'
import { PlusIcon } from './icons'

export default function Fab(): ReactElement {
  const createNote = useAppStore((s) => s.createNote)
  const notesCount = useAppStore((s) => s.notes.length)

  return (
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
  )
}
