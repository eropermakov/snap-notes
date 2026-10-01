import { useState, type ReactElement } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '../store/useAppStore'
import ProviderCard from './ai/ProviderCard'
import ThemePicker from './ThemePicker'
import HotkeyRecorder from './HotkeyRecorder'
import { Button, EASE_OUT, Modal, SettingsGroup, SettingsRow, Toggle, cn } from '../ui'

const STEPS = ['welcome', 'apiKey', 'theme', 'hotkeys', 'autostart', 'done'] as const
type Step = (typeof STEPS)[number]

const TITLES: Record<Step, { title: string; description: string }> = {
  welcome: {
    title: 'Добро пожаловать в Snap Notes',
    description:
      'Заметки с суперспособностью: выделите любой текст на экране хоткеем — приложение распознает и аккуратно причешет его прямо в заметке.'
  },
  apiKey: {
    title: 'ИИ для распознавания',
    description:
      'Без облачного ИИ текст распознаётся локально (Tesseract), но без таблиц и структуры. Подключите ChatGPT (если у вас есть план) или бесплатный ключ Gemini — остальные источники можно добавить позже.'
  },
  theme: { title: 'Оформление', description: 'Можно поменять в любой момент в настройках.' },
  hotkeys: { title: 'Хоткеи', description: 'Можно оставить по умолчанию или назначить свои.' },
  autostart: { title: 'Автозапуск', description: 'Это можно изменить позже в настройках.' },
  done: { title: 'Готово', description: 'Все параметры можно в любой момент изменить в настройках.' }
}

export default function OnboardingWizard({ open }: { open: boolean }): ReactElement {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const completeOnboarding = useAppStore((s) => s.completeOnboarding)
  const providers = useAppStore((s) => s.providers)

  const [stepIndex, setStepIndex] = useState(0)
  const [hotkeyErrors, setHotkeyErrors] = useState<{ region?: string; fullscreen?: string }>({})

  const step: Step = STEPS[stepIndex]

  const handleHotkeyChange = async (kind: 'region' | 'fullscreen', accelerator: string): Promise<void> => {
    if (!settings) return
    const result = await updateSettings({ hotkeys: { ...settings.hotkeys, [kind]: accelerator } })
    if (result) setHotkeyErrors({ region: result.region.error, fullscreen: result.fullscreen.error })
  }

  return (
    <Modal
      open={open && Boolean(settings)}
      onClose={() => undefined}
      dismissable={false}
      size="lg"
      layer="top"
      footer={
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-1.5" aria-label={`Шаг ${stepIndex + 1} из ${STEPS.length}`}>
            {STEPS.map((s, i) => (
              <span
                key={s}
                className={cn('h-1.5 rounded-full transition-all duration-slow', i === stepIndex ? 'w-5 bg-fg' : i < stepIndex ? 'w-1.5 bg-fg-muted' : 'w-1.5 bg-[var(--border-normal)]')}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {stepIndex > 0 && (
              <Button variant="ghost" onClick={() => setStepIndex((i) => i - 1)}>
                Назад
              </Button>
            )}
            {step === 'done' ? (
              <Button variant="primary" onClick={() => void completeOnboarding()}>
                Начать пользоваться
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setStepIndex((i) => i + 1)}>
                Далее
              </Button>
            )}
          </div>
        </div>
      }
    >
      {settings && (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.16, ease: EASE_OUT }}
            className="min-h-[180px] pt-2"
          >
            <h2 className={cn('font-semibold text-fg', step === 'welcome' || step === 'done' ? 'text-3xl tracking-[-0.01em]' : 'text-xl')}>
              {TITLES[step].title}
            </h2>
            <p className="mt-2 text-base text-fg-secondary">{TITLES[step].description}</p>

            <div className="mt-5">
              {step === 'apiKey' && (
                <div className="max-h-[320px] divide-y divide-line overflow-y-auto border-y border-line">
                  {providers
                    .filter((p) => (p.id === 'chatgpt' && p.integrationEnabled) || p.id === 'gemini')
                    .map((provider) => (
                      <ProviderCard key={provider.id} provider={provider} defaultOpen />
                    ))}
                </div>
              )}

              {step === 'theme' && (
                <SettingsGroup>
                  <ThemePicker value={settings.theme} onChange={(theme) => void updateSettings({ theme })} />
                </SettingsGroup>
              )}

              {step === 'hotkeys' && (
                <SettingsGroup>
                  <HotkeyRecorder
                    label="Скриншот области экрана"
                    value={settings.hotkeys.region}
                    error={hotkeyErrors.region}
                    onChange={(acc) => void handleHotkeyChange('region', acc)}
                  />
                  <HotkeyRecorder
                    label="Скриншот всего экрана"
                    value={settings.hotkeys.fullscreen}
                    error={hotkeyErrors.fullscreen}
                    onChange={(acc) => void handleHotkeyChange('fullscreen', acc)}
                  />
                </SettingsGroup>
              )}

              {step === 'autostart' && (
                <SettingsGroup>
                  <SettingsRow
                    title="Запускать при старте Windows"
                    control={
                      <Toggle
                        aria-label="Запускать при старте Windows"
                        checked={settings.launchAtStartup}
                        onChange={(checked) => void updateSettings({ launchAtStartup: checked })}
                      />
                    }
                  />
                </SettingsGroup>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      )}
    </Modal>
  )
}
