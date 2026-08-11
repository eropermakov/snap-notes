import { useState, type ReactElement } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { AiKeyEntry } from '@shared/types'
import { useAppStore } from '../store/useAppStore'
import AiKeysManager from './AiKeysManager'
import ThemePicker from './ThemePicker'
import HotkeyRecorder from './HotkeyRecorder'
import Switch from './Switch'
import { SparkleIcon } from './icons'

const STEPS = ['welcome', 'apiKey', 'theme', 'hotkeys', 'autostart', 'done'] as const
type Step = (typeof STEPS)[number]

export default function OnboardingWizard(): ReactElement {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const completeOnboarding = useAppStore((s) => s.completeOnboarding)

  const [stepIndex, setStepIndex] = useState(0)
  const [aiKeysDraft, setAiKeysDraft] = useState<AiKeyEntry[]>(settings?.aiKeys ?? [])
  const [hotkeyErrors, setHotkeyErrors] = useState<{ region?: string; fullscreen?: string }>({})

  if (!settings) return <div />

  const step: Step = STEPS[stepIndex]

  const goNext = async (): Promise<void> => {
    if (step === 'apiKey' && JSON.stringify(aiKeysDraft) !== JSON.stringify(settings.aiKeys)) {
      await updateSettings({ aiKeys: aiKeysDraft })
    }
    if (stepIndex < STEPS.length - 1) setStepIndex((i) => i + 1)
  }

  const goBack = (): void => {
    if (stepIndex > 0) setStepIndex((i) => i - 1)
  }

  const handleHotkeyChange = async (kind: 'region' | 'fullscreen', accelerator: string): Promise<void> => {
    const nextHotkeys = { ...settings.hotkeys, [kind]: accelerator }
    const result = await updateSettings({ hotkeys: nextHotkeys })
    if (result) {
      setHotkeyErrors({ region: result.region.error, fullscreen: result.fullscreen.error })
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-ink/40 p-6 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="flex w-full max-w-lg flex-col rounded-2xl border border-surface-border bg-surface p-7 shadow-card-hover"
      >
        <div className="mb-6 flex items-center justify-center gap-2">
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={`h-1.5 rounded-full transition-all ${
                i === stepIndex ? 'w-6 bg-accent' : i < stepIndex ? 'w-1.5 bg-accent/50' : 'w-1.5 bg-surface-border'
              }`}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.2 }}
            className="min-h-[240px]"
          >
            {step === 'welcome' && (
              <div className="flex flex-col items-center text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent-light text-accent">
                  <SparkleIcon className="h-8 w-8" />
                </div>
                <h2 className="mb-2 text-xl font-semibold text-ink">Добро пожаловать в Snap Notes</h2>
                <p className="text-sm text-muted">
                  Заметки в стиле Google Docs с суперспособностью: выделите любой текст на экране хоткеем — приложение
                  распознает и аккуратно причешет его прямо в заметке.
                </p>
              </div>
            )}

            {step === 'apiKey' && (
              <div>
                <h2 className="mb-1 text-lg font-semibold text-ink">API-ключи</h2>
                <p className="mb-4 text-sm text-muted">
                  Без хотя бы одного ключа распознавание текста работать не будет. Ключи бесплатные.
                </p>
                <AiKeysManager keys={aiKeysDraft} usage={{}} onChange={setAiKeysDraft} />
              </div>
            )}

            {step === 'theme' && (
              <div>
                <h2 className="mb-1 text-lg font-semibold text-ink">Тема оформления</h2>
                <p className="mb-3 text-sm text-muted">Можно поменять в любой момент в настройках.</p>
                <ThemePicker value={settings.theme} onChange={(theme) => void updateSettings({ theme })} />
              </div>
            )}

            {step === 'hotkeys' && (
              <div>
                <h2 className="mb-1 text-lg font-semibold text-ink">Хоткеи</h2>
                <p className="mb-2 text-sm text-muted">Можно оставить по умолчанию или назначить свои.</p>
                <div className="divide-y divide-surface-border">
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
                </div>
              </div>
            )}

            {step === 'autostart' && (
              <div>
                <h2 className="mb-1 text-lg font-semibold text-ink">Запускать при старте Windows?</h2>
                <p className="mb-2 text-sm text-muted">Это можно изменить позже в настройках.</p>
                <Switch
                  label="Запускать при старте Windows"
                  checked={settings.launchAtStartup}
                  onChange={(checked) => void updateSettings({ launchAtStartup: checked })}
                />
              </div>
            )}

            {step === 'done' && (
              <div className="flex flex-col items-center text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success-light text-success">
                  <SparkleIcon className="h-8 w-8" />
                </div>
                <h2 className="mb-2 text-xl font-semibold text-ink">Готово!</h2>
                <p className="text-sm text-muted">Все параметры можно в любой момент изменить в настройках.</p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="mt-6 flex justify-between">
          <button
            onClick={goBack}
            disabled={stepIndex === 0}
            className="rounded-full px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-bg disabled:opacity-0"
          >
            Назад
          </button>
          {step === 'done' ? (
            <button
              onClick={() => void completeOnboarding()}
              className="rounded-full bg-accent px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            >
              Начать пользоваться
            </button>
          ) : (
            <button
              onClick={() => void goNext()}
              className="rounded-full bg-accent px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            >
              Далее
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
