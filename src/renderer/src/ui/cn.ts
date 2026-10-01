/** Joins class names, skipping falsy values. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/** Shared motion presets: short, functional, no springs. */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const

export const motionPresets = {
  popover: {
    initial: { opacity: 0, scale: 0.98, y: -4 },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.98, y: -2 },
    transition: { duration: 0.14, ease: EASE_OUT }
  },
  modal: {
    initial: { opacity: 0, scale: 0.98, y: 6 },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.98, y: 4 },
    transition: { duration: 0.18, ease: EASE_OUT }
  },
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: 0.15, ease: EASE_OUT }
  }
} as const
