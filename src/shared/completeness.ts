export function looksIncomplete(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length < 12) return false
  if (/[.!?…»"')\]]$/.test(trimmed)) return false
  if (/(\.\.\.|…)$/.test(trimmed)) return true
  if (/[-–—]\s*$/.test(trimmed)) return true

  const lastWord = trimmed.split(/\s+/).pop() ?? ''
  if (lastWord.length === 1 && /[a-zа-яё]/i.test(lastWord)) return true

  const wordCount = trimmed.split(/\s+/).length
  if (wordCount > 6 && !/[.!?…]$/.test(trimmed)) return true

  return false
}
