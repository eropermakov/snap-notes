import { useEffect, useRef, type ReactElement } from 'react'
import type { AppToast } from '../store/useAppStore'
import { Button, IconButton } from '../ui'
import { CheckIcon, AlertTriangleIcon, XCircleIcon, CloseIcon } from './icons'

const ICON = {
  success: <CheckIcon className="h-4 w-4 text-success" />,
  warning: <AlertTriangleIcon className="h-4 w-4 text-warning" />,
  error: <XCircleIcon className="h-4 w-4 text-danger" />
}

interface Props {
  toast: AppToast
  onDismiss: () => void
}

export default function Toast({ toast, onDismiss }: Props): ReactElement {
  const hovered = useRef(false)

  useEffect(() => {
    // Pause while hovered so an "Отменить" action can still be reached.
    const timer = setInterval(() => {
      if (!hovered.current) onDismiss()
    }, toast.action ? 6000 : 4000)
    return () => clearInterval(timer)
  }, [onDismiss, toast.action])

  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => (hovered.current = true)}
      onMouseLeave={() => (hovered.current = false)}
      className="flex items-center gap-3 rounded-2xl border border-line bg-elevated py-2 pl-4 pr-2 shadow-popover"
    >
      <span className="shrink-0">{ICON[toast.type]}</span>
      <p className="min-w-0 flex-1 break-words py-1 text-base text-fg">{toast.message}</p>
      {toast.action && (
        <Button
          variant="ghost"
          size="sm"
          className="text-fg"
          onClick={() => {
            toast.action?.run()
            onDismiss()
          }}
        >
          {toast.action.label}
        </Button>
      )}
      <IconButton size="sm" label="Закрыть" tooltip={false} icon={<CloseIcon className="h-3.5 w-3.5" />} onClick={onDismiss} />
    </div>
  )
}
