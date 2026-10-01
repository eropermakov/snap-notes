import type { ReactElement } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { Button, Modal } from '../../ui'

/**
 * Shown once, after the first sign-in with ChatGPT plan usage enabled (SIWC UI/UX guidelines:
 * "You're using your ChatGPT plan" with a Got it action).
 */
export default function ChatGptWelcome(): ReactElement {
  const settings = useAppStore((s) => s.settings)
  const chatgpt = useAppStore((s) => s.providers.find((p) => p.id === 'chatgpt'))
  const updateAiSettings = useAppStore((s) => s.updateAiSettings)
  const open = Boolean(settings && !settings.ai.chatgptWelcomeSeen && chatgpt?.connection.planUsageEnabled)
  const dismiss = (): void => void updateAiSettings({ chatgptWelcomeSeen: true })

  return (
    <Modal
      open={open}
      onClose={dismiss}
      title="Вы используете свой план ChatGPT"
      description="Распознавание в Snap Notes теперь использует ваш план ChatGPT. Расход и лимиты можно посмотреть и настроить в настройках ChatGPT («Управление использованием»)."
      footer={
        <>
          <Button variant="ghost" onClick={() => void window.api.providers.openManageUsage('chatgpt')}>
            Управление использованием
          </Button>
          <Button variant="primary" onClick={dismiss} data-autofocus>
            Понятно
          </Button>
        </>
      }
    />
  )
}
