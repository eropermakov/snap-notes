import type { ReactElement } from 'react'
import { CHANGELOG } from '@shared/changelog'
import { useAppStore } from '../store/useAppStore'
import { Button, Modal } from '../ui'

export default function WhatsNewDialog({ open }: { open: boolean }): ReactElement {
  const dismissWhatsNew = useAppStore((s) => s.dismissWhatsNew)
  const latest = CHANGELOG[0]

  return (
    <Modal
      open={open}
      onClose={() => void dismissWhatsNew()}
      size="md"
      layer="top"
      title={`Что нового в ${latest.version}`}
      description={latest.date}
      footer={
        <Button variant="primary" onClick={() => void dismissWhatsNew()} data-autofocus>
          Понятно
        </Button>
      }
    >
      <ul className="space-y-3">
        {latest.items.map((item) => (
          <li key={item} className="flex gap-3 text-base text-fg">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-fg-muted" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
