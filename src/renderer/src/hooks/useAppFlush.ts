import { useEffect } from 'react'
import { flushAll } from '../utils/flushRegistry'

/** Saves pending edits when the app quits (asked by the main process) or the window unloads. */
export function useAppFlush(): void {
  useEffect(() => {
    const off = window.api.app.onFlush(() => {
      void flushAll().finally(() => window.api.app.flushed())
    })
    const onUnload = (): void => void flushAll()
    window.addEventListener('beforeunload', onUnload)
    return () => {
      off()
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [])
}
