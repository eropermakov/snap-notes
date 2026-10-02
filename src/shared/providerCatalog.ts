/**
 * STATIC provider configuration: names, official links, credential fields, how the provider is
 * presented. Nothing here is account state or a quota — models, limits and usage always come from
 * the provider at runtime (src/main/providers). When a provider changes its free plan, only the
 * texts in this file change; routing and request code keep working.
 *
 * Adding a provider = one entry here + one config in src/main/providers/impl/compatProviders.ts
 * (OpenAI-compatible) or a small adapter class.
 */
import type { ApiKeyProviderId, Capability, ProviderId } from './providers'

/** Badge on the provider card. */
export type TierBadge = 'free' | 'trial' | 'dev' | 'credits' | 'included' | 'paid' | 'advanced' | 'local'

/**
 * How the "Prefer free providers" strategy treats the provider:
 * free/included are tried first, advanced (own infrastructure) next, paid last.
 */
export type CostClass = 'free' | 'included' | 'advanced' | 'paid'

export interface ProviderField {
  id: string
  label: string
  /** Secret fields are masked and never returned to the renderer. */
  secret: boolean
  placeholder?: string
  /** Variable name in the exported .env file. */
  env: string
  required: boolean
}

export interface ProviderCatalogEntry {
  id: ProviderId
  name: string
  /** Two letters in the card's icon tile. */
  monogram: string
  tier: TierBadge
  tierLabel: string
  /** One line under the name. */
  summary: string
  /** Free-plan / privacy remarks shown inside the provider. Never a promise about limits. */
  notes: string[]
  costClass: CostClass
  /** Official page where the user creates the key. Opened in the system browser, never a search. */
  keyUrl?: string
  /** Official page with usage / limits / billing. */
  manageUrl?: string
  /** Credential fields. The first one with id 'apiKey' is the key (stored like every API key). */
  fields: ProviderField[]
  /** Capabilities shown on the card before the real catalog is known (the card shows runtime ones). */
  headlineCapabilities: Capability[]
  /** Lower is better. Used by "Best quality" / "Fastest". */
  qualityRank: number
  speedRank: number
}

const key = (env: string, placeholder: string, label = 'API-ключ'): ProviderField => ({
  id: 'apiKey',
  label,
  secret: true,
  placeholder,
  env,
  required: true
})

export const PROVIDER_CATALOG: Record<ProviderId, ProviderCatalogEntry> = {
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT',
    monogram: 'Ch',
    tier: 'included',
    tierLabel: 'План ChatGPT',
    summary: 'Использует ваш план ChatGPT, без API-ключа',
    notes: [],
    costClass: 'included',
    fields: [],
    headlineCapabilities: ['vision', 'text'],
    qualityRank: 2,
    speedRank: 6
  },
  claude: {
    id: 'claude',
    name: 'Claude',
    monogram: 'Cl',
    tier: 'paid',
    tierLabel: 'Недоступно',
    summary: 'Подписка Claude недоступна для сторонних приложений',
    notes: [],
    costClass: 'paid',
    fields: [],
    headlineCapabilities: [],
    qualityRank: 99,
    speedRank: 99
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    monogram: 'Ge',
    tier: 'free',
    tierLabel: 'Бесплатно',
    summary: 'Распознавание изображений, таблицы, код',
    notes: ['Остаток бесплатной квоты Gemini API не отдаёт — Snap Notes показывает только свой локальный счётчик и время сброса после отказа по лимиту.'],
    costClass: 'free',
    keyUrl: 'https://aistudio.google.com/apikey',
    manageUrl: 'https://aistudio.google.com/usage',
    fields: [key('GEMINI_API_KEY', 'AIza...')],
    headlineCapabilities: ['vision', 'ocr', 'text', 'tables', 'structuredOutput', 'codeRecognition'],
    qualityRank: 1,
    speedRank: 4
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    monogram: 'Gq',
    tier: 'free',
    tierLabel: 'Бесплатно',
    summary: 'Быстрый текст; изображения — только у моделей с такой возможностью',
    notes: ['Остаток запросов и токенов и время сброса Groq присылает в заголовках ответа.'],
    costClass: 'free',
    keyUrl: 'https://console.groq.com/keys',
    manageUrl: 'https://console.groq.com/settings/limits',
    fields: [key('GROQ_API_KEY', 'gsk_...')],
    headlineCapabilities: ['text', 'ocrCleanup', 'structuredOutput'],
    qualityRank: 5,
    speedRank: 2
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    monogram: 'OR',
    tier: 'free',
    tierLabel: 'Бесплатные модели',
    summary: 'Бесплатные модели подбираются автоматически под задачу',
    notes: [
      'Список бесплатных моделей меняется. «Автоматически (бесплатные)» выбирает подходящую в момент запроса; для скриншота — только модель с поддержкой изображений.',
      'У бесплатных моделей есть дневной лимит запросов; остаток и баланс Snap Notes берёт из OpenRouter.',
      'Провайдеры бесплатных моделей могут сохранять запросы и использовать их для обучения. Для конфиденциальных скриншотов выберите режим «Только офлайн» или платный источник.'
    ],
    costClass: 'free',
    keyUrl: 'https://openrouter.ai/keys',
    manageUrl: 'https://openrouter.ai/activity',
    fields: [key('OPENROUTER_API_KEY', 'sk-or-...')],
    headlineCapabilities: ['vision', 'text', 'structuredOutput', 'ocrCleanup'],
    qualityRank: 4,
    speedRank: 7
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral',
    monogram: 'Mi',
    tier: 'free',
    tierLabel: 'Бесплатный режим / платный',
    summary: 'Собственное OCR для скриншотов, документов и таблиц + текстовые модели',
    notes: [
      'В бесплатном режиме (Experiment) Mistral может использовать запросы для улучшения моделей. Отключить это можно в настройках приватности Mistral. Zero Data Retention в бесплатном режиме Snap Notes не обещает.',
      'Лимиты Mistral относятся ко всему рабочему пространству, а не к одному ключу.'
    ],
    costClass: 'free',
    keyUrl: 'https://console.mistral.ai/api-keys',
    manageUrl: 'https://console.mistral.ai/usage',
    fields: [key('MISTRAL_API_KEY', 'ключ Mistral')],
    headlineCapabilities: ['vision', 'ocr', 'text', 'tables', 'structuredOutput'],
    qualityRank: 3,
    speedRank: 5
  },
  cerebras: {
    id: 'cerebras',
    name: 'Cerebras',
    monogram: 'Ce',
    tier: 'free',
    tierLabel: 'Бесплатно',
    summary: 'Очень быстрый текст: правка OCR, списки, структура, JSON',
    notes: ['Только текст: скриншот сначала распознаёт Tesseract. Остаток запросов и токенов Cerebras присылает в заголовках ответа.'],
    costClass: 'free',
    keyUrl: 'https://cloud.cerebras.ai/platform/',
    manageUrl: 'https://cloud.cerebras.ai/platform/',
    fields: [key('CEREBRAS_API_KEY', 'csk-...')],
    headlineCapabilities: ['text', 'ocrCleanup', 'structuredOutput'],
    qualityRank: 6,
    speedRank: 1
  },
  cloudflare: {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    monogram: 'CF',
    tier: 'free',
    tierLabel: 'Бесплатная квота',
    summary: 'Модели на сети Cloudflare; бесплатная суточная квота',
    notes: [
      'Cloudflare не сообщает остаток через API, поэтому процент не рисуется. Бесплатная квота — 10 000 нейронов в сутки, сброс в 00:00 UTC (по документации).',
      'Нужен токен с правом Workers AI → Read и ID аккаунта.'
    ],
    costClass: 'free',
    keyUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    manageUrl: 'https://dash.cloudflare.com/?to=/:account/ai/workers-ai',
    fields: [
      key('CLOUDFLARE_API_TOKEN', 'токен API', 'API-токен'),
      { id: 'accountId', label: 'Account ID', secret: false, placeholder: '32 символа из панели Cloudflare', env: 'CLOUDFLARE_ACCOUNT_ID', required: true }
    ],
    headlineCapabilities: ['text', 'vision', 'ocrCleanup', 'structuredOutput'],
    qualityRank: 7,
    speedRank: 3
  },
  nvidia: {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    monogram: 'Nv',
    tier: 'dev',
    tierLabel: 'Для разработки и прототипов',
    summary: 'Размещённые модели NVIDIA API Catalog (OpenAI-совместимый API)',
    notes: [
      'Бесплатный доступ NVIDIA предназначен для разработки и прототипирования, а не для продакшена.',
      'Изображения принимаются, только если модель — VLM и скриншот не больше 180 КБ в base64; иначе работает Tesseract → текстовая модель.'
    ],
    costClass: 'free',
    keyUrl: 'https://build.nvidia.com/settings/api-keys',
    manageUrl: 'https://build.nvidia.com/settings/api-keys',
    fields: [key('NVIDIA_API_KEY', 'nvapi-...')],
    headlineCapabilities: ['text', 'vision', 'ocrCleanup', 'structuredOutput'],
    qualityRank: 8,
    speedRank: 8
  },
  cohere: {
    id: 'cohere',
    name: 'Cohere',
    monogram: 'Co',
    tier: 'trial',
    tierLabel: 'Trial · ограниченно',
    summary: 'Текст: правка OCR и структурирование',
    notes: [
      'Trial-ключ: бесплатно, но с ограничениями (по документации — 20 запросов в минуту и 1000 вызовов в месяц). Не для продакшена.',
      'Изображения принимают только vision-модели Cohere; обычные модели получают текст после Tesseract.'
    ],
    costClass: 'free',
    keyUrl: 'https://dashboard.cohere.com/api-keys',
    manageUrl: 'https://dashboard.cohere.com/billing',
    fields: [key('COHERE_API_KEY', 'ключ Cohere')],
    headlineCapabilities: ['text', 'ocrCleanup', 'structuredOutput'],
    qualityRank: 9,
    speedRank: 9
  },
  huggingface: {
    id: 'huggingface',
    name: 'Hugging Face',
    monogram: 'HF',
    tier: 'credits',
    tierLabel: 'Бесплатные кредиты',
    summary: 'Inference Providers: сотни моделей одним токеном',
    notes: [
      'Бесплатные кредиты ограничены. Остаток программно не отдаётся — показывается только статус и локальный расход.',
      'Токен: fine-grained с правом «Make calls to Inference Providers».'
    ],
    costClass: 'free',
    keyUrl: 'https://huggingface.co/settings/tokens',
    manageUrl: 'https://huggingface.co/settings/billing',
    fields: [key('HF_TOKEN', 'hf_...', 'Токен (HF_TOKEN)')],
    headlineCapabilities: ['text', 'vision', 'ocrCleanup', 'structuredOutput'],
    qualityRank: 10,
    speedRank: 10
  },
  modal: {
    id: 'modal',
    name: 'Modal OCR',
    monogram: 'Md',
    tier: 'advanced',
    tierLabel: 'Для продвинутых',
    summary: 'Ваш собственный OCR-эндпоинт на Modal (необязательно)',
    notes: [
      'Требует развёртывания integrations/modal из репозитория Snap Notes в вашем аккаунте Modal. Без Modal Snap Notes работает как обычно.',
      'Эндпоинт защищается Proxy Auth Token (Token ID и Token Secret).'
    ],
    costClass: 'advanced',
    keyUrl: 'https://modal.com/settings/proxy-auth-tokens',
    manageUrl: 'https://modal.com/settings/usage',
    fields: [
      key('MODAL_TOKEN_SECRET', 'ws-...', 'Token Secret'),
      { id: 'tokenId', label: 'Token ID', secret: true, placeholder: 'wk-...', env: 'MODAL_TOKEN_ID', required: true },
      { id: 'endpoint', label: 'OCR Endpoint', secret: false, placeholder: 'https://<workspace>--snap-notes-ocr-serve.modal.run', env: 'MODAL_OCR_ENDPOINT', required: true }
    ],
    headlineCapabilities: ['vision', 'ocr', 'tables'],
    qualityRank: 3,
    speedRank: 11
  },
  openai: {
    id: 'openai',
    name: 'OpenAI API',
    monogram: 'Oa',
    tier: 'paid',
    tierLabel: 'Платно',
    summary: 'Оплата по факту (это не ChatGPT Plus)',
    notes: [],
    costClass: 'paid',
    keyUrl: 'https://platform.openai.com/api-keys',
    manageUrl: 'https://platform.openai.com/usage',
    fields: [key('OPENAI_API_KEY', 'sk-...')],
    headlineCapabilities: ['vision', 'text', 'structuredOutput', 'tables', 'codeRecognition'],
    qualityRank: 1,
    speedRank: 6
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic API',
    monogram: 'An',
    tier: 'paid',
    tierLabel: 'Платно',
    summary: 'Оплата по факту (это не Claude Pro)',
    notes: [],
    costClass: 'paid',
    keyUrl: 'https://platform.claude.com/settings/keys',
    manageUrl: 'https://platform.claude.com/usage',
    fields: [key('ANTHROPIC_API_KEY', 'sk-ant-...')],
    headlineCapabilities: ['vision', 'text', 'structuredOutput', 'tables', 'codeRecognition'],
    qualityRank: 1,
    speedRank: 7
  },
  tesseract: {
    id: 'tesseract',
    name: 'Tesseract',
    monogram: 'Ts',
    tier: 'local',
    tierLabel: 'Офлайн · без ограничений',
    summary: 'Локальное распознавание, ничего не отправляет',
    notes: [],
    costClass: 'free',
    fields: [],
    headlineCapabilities: ['vision'],
    qualityRank: 50,
    speedRank: 50
  }
}

export function catalogEntry(id: ProviderId): ProviderCatalogEntry {
  return PROVIDER_CATALOG[id]
}

export function primaryKeyField(id: ApiKeyProviderId): ProviderField {
  return PROVIDER_CATALOG[id].fields.find((f) => f.id === 'apiKey')!
}

/** Credential fields that are not the key itself (Cloudflare account ID, Modal endpoint, …). */
export function extraFields(id: ProviderId): ProviderField[] {
  return PROVIDER_CATALOG[id].fields.filter((f) => f.id !== 'apiKey')
}

/** Secret-store id of an extra field. Matches the store's SAFE_ID pattern. */
export function fieldSecretId(provider: ProviderId, field: string): string {
  return `field-${provider}-${field}`
}

export const TIER_TONE: Record<TierBadge, 'success' | 'warning' | 'neutral'> = {
  free: 'success',
  included: 'success',
  credits: 'success',
  trial: 'warning',
  dev: 'warning',
  paid: 'neutral',
  advanced: 'neutral',
  local: 'neutral'
}
