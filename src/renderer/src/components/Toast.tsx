import { useEffect, ReactElement } from 'react'
import type { ToastPayload } from '@shared/types'
import { CheckIcon, AlertTriangleIcon, XCircleIcon, CloseIcon } from './icons'

const STYLES: Record<ToastPayload['type'], { border: string; iconColor: string }> = {
  success: { border: 'border-success', iconColor: 'text-success' },
  warning: { border: 'border-warning', iconColor: 'text-warning' },
  error: { border: 'border-danger', iconColor: 'text-danger' }
}

interface Props {
  toast: ToastPayload
  onDismiss: () => void
}

export default function Toast({ toast, onDismiss }: Props): ReactElement {
  const style = STYLES[toast.type]

  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000)
    return () => clearTimeout(timer)
  }, [onDismiss])

  return (
    <div
      className={`flex items-start gap-2.5 rounded-xl border-l-4 ${style.border} bg-surface p-3.5 shadow-card-hover`}
    >
      <span className={`mt-0.5 shrink-0 ${style.iconColor}`}>
        {toast.type === 'success' && <CheckIcon className="h-4 w-4" />}
        {toast.type === 'warning' && <AlertTriangleIcon className="h-4 w-4" />}
        {toast.type === 'error' && <XCircleIcon className="h-4 w-4" />}
      </span>
      <p className="flex-1 text-sm text-ink">{toast.message}</p>
      <button onClick={onDismiss} className="shrink-0 text-muted hover:text-ink" title="Закрыть">
        <CloseIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
