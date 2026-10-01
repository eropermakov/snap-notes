import type { ModelInfo } from '../../shared/providers'

/**
 * Central model knowledge for API providers. Model *lists* always come from each provider's official
 * list endpoint; this file only holds defaults for "Automatic" and documented vision support.
 * A model's vision flag is true/false only when documented; otherwise undefined (unknown).
 */

// --- Gemini: all Gemini generateContent models accept images (Gemini API docs, "multimodal").
export const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash'
const GEMINI_EXCLUDE = /embedding|tts|image-generation|native-audio|live|aqa|imagen|veo|robotics/i

export function geminiModelFromListing(name: string, displayName?: string, actions?: string[]): ModelInfo | null {
  const id = name.replace(/^models\//, '')
  if (!id.startsWith('gemini-') || GEMINI_EXCLUDE.test(id)) return null
  if (actions && actions.length > 0 && !actions.includes('generateContent')) return null
  return { id, displayName: displayName || id, vision: true }
}

// --- Groq: only the models on Groq's "Vision" docs page accept images.
export const GROQ_VISION_MODELS = [
  'qwen/qwen3.8-27b',
  'qwen/qwen3.6-27b',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'meta-llama/llama-4-scout-17b-16e-instruct'
]
const GROQ_EXCLUDE = /whisper|tts|guard|playai|orpheus|distil|compound|prompt-guard/i

export function groqModelFromListing(id: string, active?: boolean): ModelInfo | null {
  if (active === false || GROQ_EXCLUDE.test(id)) return null
  return { id, displayName: id, vision: GROQ_VISION_MODELS.includes(id) }
}

export function pickGroqModel(models: ModelInfo[] | null, vision: boolean): string {
  const ids = new Set((models ?? []).map((m) => m.id))
  if (models && models.length > 0) {
    const knownVision = GROQ_VISION_MODELS.find((id) => ids.has(id))
    if (knownVision) return knownVision
    if (!vision) return models[0].id
  }
  return GROQ_VISION_MODELS[0]
}

// --- OpenAI API: "All latest OpenAI models support text and image input" (OpenAI models docs).
export const OPENAI_DEFAULT_MODEL = 'gpt-6-luna'
const OPENAI_NON_CHAT = /embedding|whisper|tts|dall-e|gpt-image|image|realtime|audio|transcribe|moderation|search|davinci|babbage|sora|live|translate/i
const OPENAI_VISION_FAMILY = /^(gpt-6|gpt-5|gpt-4o|gpt-4\.1|o3|o4)/i

export function openAiModelFromListing(id: string): ModelInfo | null {
  if (OPENAI_NON_CHAT.test(id)) return null
  if (!/^(gpt-|o\d)/i.test(id)) return null
  return { id, displayName: id, ...(OPENAI_VISION_FAMILY.test(id) ? { vision: true } : {}) }
}

// --- Anthropic API: all current Claude models accept image input (Anthropic vision docs).
export const ANTHROPIC_DEFAULT_MODEL = 'claude-haiku-4-5'

export function anthropicModelFromListing(id: string, displayName?: string): ModelInfo | null {
  if (!id.startsWith('claude-')) return null
  return { id, displayName: displayName || id, vision: true }
}

/** Picks `preferred` when the catalog has it (or when there is no catalog), else the first model that fits. */
export function pickModel(models: ModelInfo[] | null, preferred: string, vision: boolean): string {
  if (!models || models.length === 0) return preferred
  if (models.some((m) => m.id === preferred)) return preferred
  const fit = models.find((m) => (vision ? m.vision === true : true))
  return fit?.id ?? preferred
}
