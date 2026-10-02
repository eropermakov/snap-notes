import type { ReactElement } from 'react'

/** Small read-only chips on a card: the first few tags and a "+N" for the rest. */
export function TagChips({ tags, max = 3 }: { tags: string[]; max?: number }): ReactElement | null {
  if (tags.length === 0) return null
  const shown = tags.slice(0, max)
  const rest = tags.length - shown.length
  return (
    <div className="flex flex-wrap items-center gap-1" aria-label={`Теги: ${tags.join(', ')}`}>
      {shown.map((tag) => (
        <span key={tag} className="tag-chip">
          <span aria-hidden>#</span>
          <span className="truncate">{tag}</span>
        </span>
      ))}
      {rest > 0 && <span className="tag-chip">+{rest}</span>}
    </div>
  )
}
