import { useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { cn, motionPresets } from './cn'
import { Button } from './Button'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  /** When false, Escape and scrim clicks do nothing (e.g. onboarding). */
  dismissable?: boolean
  className?: string
  /** Put the panel above other overlays (onboarding, release notes). */
  layer?: 'default' | 'top'
}

const SIZES = { sm: 'max-w-[400px]', md: 'max-w-[480px]', lg: 'max-w-[560px]' }

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'sm',
  dismissable = true,
  className,
  layer = 'default'
}: ModalProps): ReactElement {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return undefined
    const previouslyFocused = document.activeElement as HTMLElement | null
    const id = requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? panelRef.current)?.focus()
    })
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && dismissable) {
        e.stopPropagation()
        onCloseRef.current()
      }
      if (e.key === 'Tab' && panelRef.current) {
        const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
        if (items.length === 0) return
        const first = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      cancelAnimationFrame(id)
      document.removeEventListener('keydown', onKey, true)
      previouslyFocused?.focus?.()
    }
  }, [open, dismissable])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          {...motionPresets.fade}
          className={cn('fixed inset-0 flex items-center justify-center bg-[var(--scrim)] p-6', layer === 'top' ? 'z-[350]' : 'z-[320]')}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && dismissable) onCloseRef.current()
          }}
        >
          <motion.div
            ref={panelRef}
            {...motionPresets.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-describedby={description ? descId : undefined}
            tabIndex={-1}
            className={cn('ui-dialog flex max-h-full w-full flex-col rounded-3xl border border-[var(--border-card)] bg-elevated shadow-modal outline-none', SIZES[size], className)}
          >
            {(title || description) && (
              <div className="px-6 pt-6">
                {title && (
                  <h2 id={titleId} className="text-lg font-semibold text-fg">
                    {title}
                  </h2>
                )}
                {description && (
                  <p id={descId} className="mt-1.5 text-base text-fg-secondary">
                    {description}
                  </p>
                )}
              </div>
            )}
            {children && <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4">{children}</div>}
            {footer && <div className="flex items-center justify-end gap-2 px-6 pb-5 pt-6">{footer}</div>}
            {!footer && <div className="h-6 shrink-0" />}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

interface ConfirmProps {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ open, title, description, confirmLabel, cancelLabel = 'Отмена', danger, onConfirm, onCancel }: ConfirmProps): ReactElement {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      footer={
        <>
          {/* Destructive dialogs focus the safe choice first. */}
          <Button variant="ghost" onClick={onCancel} data-autofocus={danger ? true : undefined}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} data-autofocus={danger ? undefined : true}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  )
}
